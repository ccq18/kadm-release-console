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

export function buildReplicaSetsRequest({ apiServer, token, namespace, labelSelector }) {
  const params = new URLSearchParams();
  if (labelSelector) {
    params.set("labelSelector", labelSelector);
  }

  return {
    url: joinUrl(
      apiServer,
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/replicasets${params.toString() ? `?${params.toString()}` : ""}`
    ),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildReplicaSetDeleteRequest({ apiServer, token, namespace, replicaSet }) {
  return {
    url: joinUrl(
      apiServer,
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/replicasets/${encodeURIComponent(replicaSet)}`
    ),
    method: "DELETE",
    headers: jsonHeaders(token)
  };
}

export function buildRolloutTemplatePatch(template) {
  return {
    spec: {
      template
    }
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

export function buildRolloutTemplatePatchRequest({ apiServer, token, namespace, rollout, template }) {
  return {
    url: rolloutUrl(apiServer, namespace, rollout),
    method: "PATCH",
    headers: jsonHeaders(token, {
      "Content-Type": "application/merge-patch+json"
    }),
    body: JSON.stringify(buildRolloutTemplatePatch(template))
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

  async getReplicaSets(app) {
    const data = await sendJsonRequest(
      buildReplicaSetsRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        labelSelector: `app.kubernetes.io/name=${app.rollout.name}`
      }),
      this.fetchImpl
    );
    return data.items || [];
  }

  async deleteReplicaSet(app, replicaSet) {
    return sendJsonRequest(
      buildReplicaSetDeleteRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        replicaSet
      }),
      this.fetchImpl
    );
  }

  async switchVersion(app, version, replicaSets) {
    const replicaSet = replicaSets.find(
      (candidate) => candidate.metadata?.name === version.resourceName
    );
    if (!replicaSet?.spec?.template) {
      throw new Error(`ReplicaSet template not found for version: ${version.hash}`);
    }

    await sendJsonRequest(
      buildRolloutTemplatePatchRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        rollout: app.rollout.name,
        template: sanitizeReplicaSetTemplate(replicaSet.spec.template)
      }),
      this.fetchImpl
    );

    return sendJsonRequest(
      buildRolloutActionRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        rollout: app.rollout.name,
        action: "promote"
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

function sanitizeReplicaSetTemplate(template) {
  const clone = structuredClone(template);
  if (clone.metadata?.labels) {
    delete clone.metadata.labels["rollouts-pod-template-hash"];
    delete clone.metadata.labels["pod-template-hash"];
  }
  if (clone.metadata) {
    delete clone.metadata.creationTimestamp;
    delete clone.metadata.uid;
    delete clone.metadata.resourceVersion;
    delete clone.metadata.managedFields;
  }
  return clone;
}

function rolloutUrl(apiServer, namespace, rollout) {
  return joinUrl(
    apiServer,
    `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/rollouts/${encodeURIComponent(rollout)}`
  );
}
