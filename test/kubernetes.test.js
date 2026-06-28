import test from "node:test";
import assert from "node:assert/strict";
import {
  KubernetesRolloutsClient,
  buildRolloutGetRequest,
  buildRolloutActionRequest,
  buildRolloutActionPatch,
  buildReplicaSetsRequest,
  buildReplicaSetDeleteRequest
} from "../src/kubernetes.js";

test("builds a Rollout get request against the Kubernetes API", () => {
  const request = buildRolloutGetRequest({
    apiServer: "https://kubernetes.default.svc",
    token: "kube-token",
    namespace: "apps",
    rollout: "hello"
  });

  assert.equal(
    request.url,
    "https://kubernetes.default.svc/apis/argoproj.io/v1alpha1/namespaces/apps/rollouts/hello"
  );
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, "Bearer kube-token");
});

test("builds promote and abort Rollout status patches", () => {
  assert.deepEqual(buildRolloutActionPatch("promote"), {
    status: { promoteFull: true }
  });
  assert.deepEqual(buildRolloutActionPatch("abort"), {
    status: { abort: true }
  });
});

test("builds restart Rollout spec patch", () => {
  const patch = buildRolloutActionPatch("restart", new Date("2026-06-26T08:00:00.000Z"));
  assert.deepEqual(patch, {
    spec: { restartAt: "2026-06-26T08:00:00.000Z" }
  });
});

test("uses the status subresource for promote and abort", () => {
  const request = buildRolloutActionRequest({
    apiServer: "https://kubernetes.default.svc",
    token: "kube-token",
    namespace: "apps",
    rollout: "hello",
    action: "promote"
  });

  assert.equal(
    request.url,
    "https://kubernetes.default.svc/apis/argoproj.io/v1alpha1/namespaces/apps/rollouts/hello/status"
  );
  assert.equal(request.method, "PATCH");
  assert.equal(request.headers["Content-Type"], "application/merge-patch+json");
  assert.deepEqual(JSON.parse(request.body), { status: { promoteFull: true } });
});

test("builds a ReplicaSet list request for rollout revisions", () => {
  const request = buildReplicaSetsRequest({
    apiServer: "https://kubernetes.default.svc",
    token: "kube-token",
    namespace: "apps",
    labelSelector: "app.kubernetes.io/name=hello"
  });

  assert.equal(
    request.url,
    "https://kubernetes.default.svc/apis/apps/v1/namespaces/apps/replicasets?labelSelector=app.kubernetes.io%2Fname%3Dhello"
  );
  assert.equal(request.method, "GET");
});

test("builds a ReplicaSet delete request for retained revisions", () => {
  const request = buildReplicaSetDeleteRequest({
    apiServer: "https://kubernetes.default.svc",
    token: "kube-token",
    namespace: "apps",
    replicaSet: "hello-6d4f8b87c5"
  });

  assert.equal(
    request.url,
    "https://kubernetes.default.svc/apis/apps/v1/namespaces/apps/replicasets/hello-6d4f8b87c5"
  );
  assert.equal(request.method, "DELETE");
});

test("getDiagnostics ignores stale warning events once all current pods are ready", async () => {
  const client = new KubernetesRolloutsClient({
    apiServer: "https://kubernetes.default.svc",
    token: "kube-token"
  });

  client.getPods = async () => [
    {
      metadata: { name: "hellospring-abc" },
      spec: {
        nodeName: "worker-1",
        containers: [{ name: "hello", image: "ghcr.io/ccq18/demo-hello-spring:sha-1234567" }]
      },
      status: {
        phase: "Running",
        startTime: "2026-06-28T04:00:00Z",
        containerStatuses: [
          {
            ready: true,
            restartCount: 0,
            state: { running: { startedAt: "2026-06-28T04:00:05Z" } }
          }
        ]
      }
    }
  ];
  client.getEvents = async () => [
    {
      type: "Warning",
      reason: "Unhealthy",
      message: "Readiness probe failed during startup",
      involvedObject: { kind: "Pod", name: "hellospring-abc" },
      lastTimestamp: "2026-06-28T04:00:08Z"
    }
  ];
  client.getPodLogs = async () => "app is healthy";

  const diagnostics = await client.getDiagnostics({
    rollout: { namespace: "apps", name: "hellospring" }
  });

  assert.equal(diagnostics.summary, null);
  assert.equal(diagnostics.pods[0].ready, true);
});
