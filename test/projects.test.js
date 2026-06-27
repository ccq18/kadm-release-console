import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRegistryApplication,
  EffectiveProjectRegistryService,
  KubernetesSourceProjectRegistry
} from "../src/projects.js";

const baseApp = {
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
    image: "ghcr.io/ccq18/demo-hello",
    ref: "main"
  },
  argocd: {
    application: "demo-hello"
  },
  rollout: {
    namespace: "apps",
    name: "hello"
  }
};

test("buildRegistryApplication creates an Argo Application from the effective registry entry", () => {
  const resource = buildRegistryApplication(baseApp);

  assert.equal(resource.metadata.name, "demo-hello");
  assert.equal(resource.metadata.labels["kadm.ai/managed-by"], "effective-registry");
  assert.equal(resource.spec.source.repoURL, "https://github.com/ccq18/kadm-app-configs.git");
  assert.equal(resource.spec.destination.namespace, "apps");
});

test("EffectiveProjectRegistryService create/update/delete mutate only the effective registry and Argo Applications", async () => {
  const calls = [];
  const kubernetes = {
    apps: [baseApp],
    async readRegistryApps() {
      return this.apps;
    },
    async writeRegistryApps(apps) {
      this.apps = apps;
      calls.push({ type: "writeRegistryApps", apps });
    },
    async upsertApplication(app) {
      calls.push({ type: "upsertApplication", app });
      return { ok: true };
    },
    async deleteApplication(name) {
      calls.push({ type: "deleteApplication", name });
      return { deleted: true };
    }
  };
  const service = new EffectiveProjectRegistryService({ kubernetes });

  const created = await service.createApp({
    id: "demo-hello-spring",
    name: "Demo Hello Spring",
    github: {
      owner: "ccq18",
      repo: "demo-hello-spring",
      workflow: "build-and-publish.yaml",
      ref: "main"
    },
    gitops: {
      owner: "ccq18",
      repo: "kadm-app-configs",
      path: "apps/demo-hello-spring/overlays/prod",
      image: "ghcr.io/ccq18/demo-hello-spring",
      ref: "main"
    },
    argocd: {
      application: "demo-hello-spring"
    },
    rollout: {
      namespace: "apps",
      name: "hellospring"
    }
  });

  assert.equal(created.id, "demo-hello-spring");

  const updated = await service.updateApp("demo-hello", {
    name: "Demo Hello Updated",
    gitops: {
      path: "apps/demo-hello/overlays/staging"
    }
  });

  assert.equal(updated.name, "Demo Hello Updated");
  assert.equal(updated.gitops.path, "apps/demo-hello/overlays/staging");

  const deleted = await service.deleteApp("demo-hello-spring");
  assert.deepEqual(deleted, { deleted: true, id: "demo-hello-spring" });

  assert.deepEqual(
    calls.map((call) => call.type),
    [
      "writeRegistryApps",
      "upsertApplication",
      "writeRegistryApps",
      "upsertApplication",
      "writeRegistryApps",
      "deleteApplication"
    ]
  );
});

test("EffectiveProjectRegistryService rejects renaming a project id or Argo Application name in place", async () => {
  const service = new EffectiveProjectRegistryService({
    kubernetes: {
      async readRegistryApps() {
        return [baseApp];
      }
    }
  });

  await assert.rejects(
    () => service.updateApp("demo-hello", { id: "new-id" }),
    /Project id cannot be changed/
  );
  await assert.rejects(
    () => service.updateApp("demo-hello", { argocd: { application: "new-app" } }),
    /Argo CD application name cannot be changed/
  );
});

test("KubernetesSourceProjectRegistry loads cached source projects from the cluster registry cache", async () => {
  const source = new KubernetesSourceProjectRegistry({
    fallbackApps: [baseApp],
    kubernetes: {
      async readSourceApps() {
        return [baseApp];
      }
    }
  });

  const apps = await source.listApps();
  assert.equal(apps[0].id, "demo-hello");
});
