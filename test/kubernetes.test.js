import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRolloutGetRequest,
  buildRolloutActionRequest,
  buildRolloutActionPatch
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
