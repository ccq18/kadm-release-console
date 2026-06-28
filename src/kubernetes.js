import fs from "node:fs";
import { joinUrl, jsonHeaders, sendJsonRequest, sendTextRequest } from "./request.js";

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

export function buildPodsRequest({ apiServer, token, namespace, labelSelector }) {
  const params = new URLSearchParams();
  if (labelSelector) {
    params.set("labelSelector", labelSelector);
  }
  return {
    url: joinUrl(
      apiServer,
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods${params.toString() ? `?${params.toString()}` : ""}`
    ),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildEventsRequest({ apiServer, token, namespace }) {
  return {
    url: joinUrl(apiServer, `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildPodLogsRequest({ apiServer, token, namespace, pod, container, tailLines = 80 }) {
  const params = new URLSearchParams({
    tailLines: String(tailLines)
  });
  if (container) {
    params.set("container", container);
  }
  return {
    url: joinUrl(
      apiServer,
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?${params.toString()}`
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

  async getPods(app) {
    const data = await sendJsonRequest(
      buildPodsRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: app.rollout.namespace,
        labelSelector: `app.kubernetes.io/name=${app.rollout.name}`
      }),
      this.fetchImpl
    );
    return data.items || [];
  }

  async getEvents(namespace) {
    const data = await sendJsonRequest(
      buildEventsRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace
      }),
      this.fetchImpl
    );
    return data.items || [];
  }

  async getPodLogs(namespace, pod, container) {
    return sendTextRequest(
      buildPodLogsRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace,
        pod,
        container
      }),
      this.fetchImpl
    );
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

  async getDiagnostics(app) {
    const pods = await this.getPods(app);
    const podNames = new Set(pods.map((pod) => pod.metadata?.name).filter(Boolean));
    const events = (await this.getEvents(app.rollout.namespace))
      .filter((event) => {
        const kind = event?.involvedObject?.kind || "";
        const name = event?.involvedObject?.name || "";
        if (kind === "Pod" && podNames.has(name)) {
          return true;
        }
        return kind === "Rollout" && name === app.rollout.name;
      })
      .sort((left, right) => timestampOf(right) - timestampOf(left))
      .slice(0, 20)
      .map(summarizeEvent);

    const summarizedPods = pods.map(summarizePod);
    const logs = [];
    for (const pod of pods.slice(0, 2)) {
      const primary = pod?.spec?.containers?.[0]?.name || null;
      const state = pod?.status?.containerStatuses?.[0]?.state || {};
      if (!state.running && !state.terminated) {
        continue;
      }
      try {
        logs.push({
          pod: pod.metadata?.name || "unknown",
          container: primary,
          text: await this.getPodLogs(app.rollout.namespace, pod.metadata?.name, primary)
        });
      } catch (error) {
        logs.push({
          pod: pod.metadata?.name || "unknown",
          container: primary,
          error: error.message
        });
      }
    }

    return {
      summary: summarizeDiagnostics(summarizedPods, events),
      pods: summarizedPods,
      events,
      logs
    };
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

function summarizePod(pod) {
  const status = pod?.status || {};
  const containerStatus = status.containerStatuses?.[0] || {};
  const waiting = containerStatus.state?.waiting || null;
  const terminated = containerStatus.state?.terminated || null;
  return {
    name: pod?.metadata?.name || "unknown",
    phase: status.phase || "Unknown",
    ready: Boolean(containerStatus.ready),
    restartCount: containerStatus.restartCount || 0,
    nodeName: pod?.spec?.nodeName || null,
    image: pod?.spec?.containers?.[0]?.image || null,
    reason: waiting?.reason || terminated?.reason || null,
    message: waiting?.message || terminated?.message || null,
    startedAt: status.startTime || null
  };
}

function summarizeEvent(event) {
  return {
    type: event?.type || "Normal",
    reason: event?.reason || "",
    message: event?.message || "",
    involvedKind: event?.involvedObject?.kind || "",
    involvedName: event?.involvedObject?.name || "",
    lastTimestamp:
      event?.lastTimestamp ||
      event?.eventTime ||
      event?.metadata?.creationTimestamp ||
      null
  };
}

function summarizeDiagnostics(pods, events) {
  const blockedPods = pods.filter(isBlockedPod);
  if (blockedPods.length === 0) {
    return null;
  }

  const blockedPodNames = new Set(blockedPods.map((pod) => pod.name));
  const failedEvent = events.find(
    (event) =>
      event.type === "Warning" &&
      (event.involvedKind === "Rollout" ||
        (event.involvedKind === "Pod" && blockedPodNames.has(event.involvedName)))
  );
  if (failedEvent) {
    return {
      severity: "error",
      message: failedEvent.message
    };
  }
  const blockedPod = blockedPods[0];
  if (blockedPod) {
    return {
      severity: "warn",
      message: blockedPod.message || blockedPod.reason || `${blockedPod.name} is ${blockedPod.phase}`
    };
  }
  return null;
}

function isBlockedPod(pod) {
  return !pod.ready || Boolean(pod.reason) || pod.phase !== "Running";
}

function timestampOf(event) {
  const value = event?.lastTimestamp || event?.eventTime || event?.metadata?.creationTimestamp || "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
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
