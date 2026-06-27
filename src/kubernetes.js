import fs from "node:fs";
import { joinUrl, jsonHeaders, sendJsonRequest } from "./request.js";

const SERVICE_ACCOUNT_TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token";

export function buildRolloutGetRequest({ apiServer, token, namespace, rollout }) {
  return {
    url: rolloutUrl(apiServer, namespace, rollout),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildRolloutActionPatch(action, now = new Date()) {
  if (action === "promote") {
    return { status: { promoteFull: true } };
  }
  if (action === "abort") {
    return { status: { abort: true } };
  }
  if (action === "restart") {
    return { spec: { restartAt: now.toISOString() } };
  }
  throw new Error(`Unsupported rollout action: ${action}`);
}

export function buildRolloutActionRequest({ apiServer, token, namespace, rollout, action, now }) {
  const usesStatusSubresource = action === "promote" || action === "abort";
  const url = usesStatusSubresource
    ? `${rolloutUrl(apiServer, namespace, rollout)}/status`
    : rolloutUrl(apiServer, namespace, rollout);

  return {
    url,
    method: "PATCH",
    headers: jsonHeaders(token, {
      "Content-Type": "application/merge-patch+json"
    }),
    body: JSON.stringify(buildRolloutActionPatch(action, now))
  };
}

export class KubernetesRolloutsClient {
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

    return new KubernetesRolloutsClient({ apiServer, token });
  }

  async getRollout(app) {
    return sendJsonRequest(
      buildRolloutGetRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        rollout: app.rollout.name
      }),
      this.fetchImpl
    );
  }

  async runAction(app, action) {
    return sendJsonRequest(
      buildRolloutActionRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        rollout: app.rollout.name,
        action
      }),
      this.fetchImpl
    );
  }
}

function rolloutUrl(apiServer, namespace, rollout) {
  return joinUrl(
    apiServer,
    `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/rollouts/${encodeURIComponent(rollout)}`
  );
}
