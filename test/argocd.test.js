import test from "node:test";
import assert from "node:assert/strict";
import { buildApplicationRequest, buildSyncRequest } from "../src/argocd.js";

test("builds an Argo CD application status request", () => {
  const request = buildApplicationRequest({
    baseUrl: "https://argocd.example.com/",
    token: "argocd-token",
    application: "demo-hello",
    insecureTLS: true
  });

  assert.equal(request.url, "https://argocd.example.com/api/v1/applications/demo-hello");
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, "Bearer argocd-token");
  assert.equal(request.insecureTLS, true);
});

test("builds an Argo CD sync request", () => {
  const request = buildSyncRequest({
    baseUrl: "https://argocd.example.com",
    token: "argocd-token",
    application: "demo-hello",
    revision: "main"
  });

  assert.equal(request.url, "https://argocd.example.com/api/v1/applications/demo-hello/sync");
  assert.equal(request.method, "POST");
  assert.deepEqual(JSON.parse(request.body), {
    revision: "main",
    prune: true,
    dryRun: false
  });
});
