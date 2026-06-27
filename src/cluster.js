import fs from "node:fs";
import { joinUrl, jsonHeaders, sendJsonRequest } from "./request.js";

const SERVICE_ACCOUNT_TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token";

export class ClusterService {
  constructor({ kubernetes, clusterName, joinServerUrl, joinToken }) {
    this.kubernetes = kubernetes;
    this.clusterName = clusterName || "default";
    this.joinServerUrl = joinServerUrl || "";
    this.joinToken = joinToken || "";
  }

  static fromEnv(env = process.env) {
    return new ClusterService({
      kubernetes: KubernetesClusterClient.fromEnv(env),
      clusterName: env.KADM_CLUSTER_NAME || env.ONECD_CLUSTER_NAME || "default",
      joinServerUrl: env.K3S_JOIN_SERVER_URL || "",
      joinToken: env.K3S_JOIN_TOKEN || ""
    });
  }

  async getCluster() {
    const response = await this.kubernetes.listNodes();
    const nodes = normalizeNodes(response.items || []);
    return {
      clusterName: this.clusterName,
      summary: summarizeNodes(nodes),
      nodes
    };
  }

  generateJoinScript({ role }) {
    return buildJoinScript({
      role,
      serverUrl: this.joinServerUrl,
      token: this.joinToken
    });
  }
}

export class KubernetesClusterClient {
  constructor({ apiServer, token, fetchImpl }) {
    this.apiServer = apiServer;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env = process.env) {
    const apiServer =
      env.KUBE_API_SERVER ||
      `https://${env.KUBERNETES_SERVICE_HOST || "kubernetes.default.svc"}:${env.KUBERNETES_SERVICE_PORT_HTTPS || "443"}`;
    const token =
      env.KUBE_TOKEN ||
      (fs.existsSync(SERVICE_ACCOUNT_TOKEN)
        ? fs.readFileSync(SERVICE_ACCOUNT_TOKEN, "utf8").trim()
        : "");

    return new KubernetesClusterClient({ apiServer, token });
  }

  async listNodes() {
    return sendJsonRequest(
      {
        url: joinUrl(this.apiServer, "/api/v1/nodes"),
        method: "GET",
        headers: jsonHeaders(this.token)
      },
      this.fetchImpl
    );
  }
}

export function normalizeNodes(items) {
  return items.map((node) => {
    const labels = node.metadata?.labels || {};
    const addresses = node.status?.addresses || [];
    const conditions = node.status?.conditions || [];
    const readyCondition = conditions.find((condition) => condition.type === "Ready");
    return {
      name: node.metadata?.name || "unknown",
      role: nodeRole(labels),
      ready: readyCondition?.status === "True",
      internalIP: findAddress(addresses, "InternalIP"),
      externalIP: findAddress(addresses, "ExternalIP"),
      kubeletVersion: node.status?.nodeInfo?.kubeletVersion || null,
      osImage: node.status?.nodeInfo?.osImage || null
    };
  });
}

export function summarizeNodes(nodes) {
  const masters = nodes.filter((node) => node.role === "master").length;
  const workers = nodes.filter((node) => node.role === "worker").length;
  const ready = nodes.filter((node) => node.ready).length;
  return {
    total: nodes.length,
    ready,
    masters,
    workers,
    phase: clusterPhase(masters),
    guidance: clusterGuidance(masters)
  };
}

export function buildJoinScript({ role, serverUrl, token }) {
  if (!["master", "worker"].includes(role)) {
    const error = new Error(`Unsupported node role: ${role}`);
    error.status = 400;
    throw error;
  }
  if (!serverUrl || !token) {
    const error = new Error("K3S_JOIN_SERVER_URL and K3S_JOIN_TOKEN are required to generate join scripts.");
    error.status = 409;
    throw error;
  }

  const exec = role === "master"
    ? `server --server ${shellQuote(serverUrl)} --flannel-backend=none --disable-network-policy --disable-kube-proxy --disable=traefik --disable=servicelb`
    : `agent --server ${shellQuote(serverUrl)}`;
  const warning = role === "master"
    ? "Adding a second master is an intermediate state, not high availability. Add a third master for recommended HA."
    : null;

  return {
    role,
    warning,
    script: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `INSTALL_K3S_EXEC=${shellQuote(exec)}`,
      "detect_private_ip() {",
      '  if [ -n "${KADM_NODE_PRIVATE_IP:-}" ]; then',
      '    printf "%s\\n" "${KADM_NODE_PRIVATE_IP}"',
      "    return 0",
      "  fi",
      "  if command -v ip >/dev/null 2>&1; then",
      "    ip -o -4 route show to default 2>/dev/null | awk '{print $7; exit}'",
      "    return 0",
      "  fi",
      "  if command -v hostname >/dev/null 2>&1; then",
      "    hostname -I 2>/dev/null | awk '{print $1}'",
      "    return 0",
      "  fi",
      "}",
      'NODE_PRIVATE_IP="$(detect_private_ip || true)"',
      'if [ -n "${NODE_PRIVATE_IP}" ]; then',
      '  INSTALL_K3S_EXEC="${INSTALL_K3S_EXEC} --node-ip ${NODE_PRIVATE_IP}"',
      role === "master"
        ? '  INSTALL_K3S_EXEC="${INSTALL_K3S_EXEC} --advertise-address ${NODE_PRIVATE_IP}"'
        : '  :',
      "fi",
      `export K3S_TOKEN=${shellQuote(token)}`,
      'curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="${INSTALL_K3S_EXEC}" sh -'
    ].join("\n")
  };
}

function nodeRole(labels) {
  if (
    labels["node-role.kubernetes.io/control-plane"] !== undefined ||
    labels["node-role.kubernetes.io/master"] !== undefined ||
    labels["node-role.kubernetes.io/etcd"] !== undefined
  ) {
    return "master";
  }
  return "worker";
}

function findAddress(addresses, type) {
  return addresses.find((address) => address.type === type)?.address || null;
}

function clusterPhase(masters) {
  if (masters <= 1) {
    return "single-node";
  }
  if (masters === 2) {
    return "two-master-not-ha";
  }
  if (masters === 3) {
    return "ha-recommended";
  }
  if (masters === 5) {
    return "ha-advanced";
  }
  return "nonstandard-master-count";
}

function clusterGuidance(masters) {
  if (masters <= 1) {
    return "单 Master 起步模式，不是高可用。可以继续添加 Worker，或添加两个 Master 升级为三 Master HA。";
  }
  if (masters === 2) {
    return "两个 Master 不是高可用：etcd 需要 2/2 多数派，任意一台故障都会影响控制面。建议继续加入第三个 Master。";
  }
  if (masters === 3) {
    return "三 Master 是推荐高可用控制面形态。后续容量优先添加 Worker。";
  }
  return "当前 Master 数量不是普通模式推荐形态，请确认 etcd quorum 和容量规划。";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
