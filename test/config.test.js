import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAppsConfig } from "../src/config.js";

test("normalizes the two default applications", () => {
  const apps = normalizeAppsConfig([
    {
      id: "demo-hello",
      name: "Demo Hello",
      github: {
        owner: "ccq18",
        repo: "demo-hello",
        workflow: "build-and-publish.yaml",
        ref: "main"
      },
      gitops: {
        owner: "ccq18",
        repo: "kadm-app-configs",
        path: "apps/demo-hello/overlays/prod",
        image: "ghcr.io/ccq18/demo-hello"
      },
      argocd: { application: "demo-hello" },
      rollout: { namespace: "apps", name: "hello" }
    }
  ]);

  assert.equal(apps[0].id, "demo-hello");
  assert.equal(apps[0].github.ref, "main");
  assert.equal(apps[0].gitops.repo, "kadm-app-configs");
  assert.equal(apps[0].gitops.path, "apps/demo-hello/overlays/prod");
  assert.equal(apps[0].argocd.application, "demo-hello");
  assert.equal(apps[0].rollout.namespace, "apps");
});

test("rejects applications without required integration fields", () => {
  assert.throws(
    () => normalizeAppsConfig([{ id: "broken", name: "Broken" }]),
    /github.owner is required/
  );
});
