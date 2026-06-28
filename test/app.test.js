import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

const appConfig = {
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

const secondAppConfig = {
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
};

test("status includes release task and derived versions", async () => {
  const server = await listen({
    releaseManager: {
      getTask() {
        return { status: "running", stage: "building" };
      }
    },
    rollouts: {
      async getRollout() {
        return { status: { phase: "Paused", stableRS: "old-hash", currentPodHash: "new-hash" } };
      },
      async getDiagnostics() {
        return {
          summary: { severity: "error", message: 'Error: secret "demo-db" not found' },
          pods: [{ name: "demo-0", phase: "Pending", reason: "CreateContainerConfigError" }],
          events: [{ reason: "Failed", message: 'Error: secret "demo-db" not found' }],
          logs: []
        };
      }
    }
  });

  try {
    const data = await request(server, "/api/apps/demo-hello/status");

    assert.equal(data.releaseTask.status, "running");
    assert.deepEqual(data.versions.map((version) => version.hash), ["new-hash", "old-hash"]);
    assert.equal(data.diagnostics.summary.severity, "error");
    assert.match(data.diagnostics.events[0].message, /secret/);
  } finally {
    await close(server);
  }
});

test("release route starts an in-memory publish task", async () => {
  const calls = [];
  const server = await listen({
    releaseManager: {
      getTask() {
        return null;
      },
      start(app, options) {
        calls.push({ appId: app.id, options });
        return { status: "running", stage: "building", imageTag: options.imageTag };
      }
    }
  });

  try {
    const data = await request(server, "/api/apps/demo-hello/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageTag: "sha-abc1234" })
    });

    assert.equal(data.releaseTask.status, "running");
    assert.deepEqual(calls, [{ appId: "demo-hello", options: { imageTag: "sha-abc1234" } }]);
  } finally {
    await close(server);
  }
});

test("promote route validates the selected candidate version", async () => {
  const calls = [];
  const server = await listen({
    rollouts: {
      async getRollout() {
        return { status: { phase: "Paused", stableRS: "old-hash", currentPodHash: "new-hash" } };
      },
      async runAction(app, action) {
        calls.push({ appId: app.id, action });
        return { patched: true };
      }
    }
  });

  try {
    const data = await request(server, "/api/apps/demo-hello/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionHash: "new-hash" })
    });

    assert.equal(data.action, "promote");
    assert.deepEqual(calls, [{ appId: "demo-hello", action: "promote" }]);
  } finally {
    await close(server);
  }
});

test("promote route rejects switching to the current stable version", async () => {
  const server = await listen({
    rollouts: {
      async getRollout() {
        return { status: { phase: "Paused", stableRS: "old-hash", currentPodHash: "new-hash" } };
      },
      async runAction() {
        throw new Error("promote should not run for a stable version");
      }
    }
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/apps/demo-hello/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionHash: "old-hash" })
    });
    const data = await response.json();

    assert.equal(response.status, 409);
    assert.match(data.error, /not promotable/);
  } finally {
    await close(server);
  }
});

test("switch route moves all traffic to a retained version", async () => {
  const calls = [];
  const server = await listen({
    rollouts: {
      async getRollout() {
        return { status: { phase: "Healthy", stableRS: "new-hash", currentPodHash: "new-hash" } };
      },
      async getReplicaSets() {
        return [
          {
            metadata: {
              name: "hello-new-hash",
              creationTimestamp: "2026-06-28T00:00:00Z",
              labels: { "rollouts-pod-template-hash": "new-hash" }
            },
            spec: { replicas: 2, template: { metadata: { labels: { "app.kubernetes.io/name": "hello" } }, spec: { containers: [{ name: "hello", image: "new" }] } } },
            status: { replicas: 2, readyReplicas: 2 }
          },
          {
            metadata: {
              name: "hello-old-hash",
              creationTimestamp: "2026-06-27T00:00:00Z",
              labels: { "rollouts-pod-template-hash": "old-hash" }
            },
            spec: { replicas: 0, template: { metadata: { labels: { "app.kubernetes.io/name": "hello" } }, spec: { containers: [{ name: "hello", image: "old" }] } } },
            status: { replicas: 0, readyReplicas: 0 }
          }
        ];
      },
      async switchVersion(app, version) {
        calls.push({ appId: app.id, hash: version.hash, resourceName: version.resourceName });
        return { switched: true };
      },
      async runAction() {
        return {};
      }
    }
  });

  try {
    const data = await request(server, "/api/apps/demo-hello/versions/old-hash/switch", {
      method: "POST"
    });

    assert.equal(data.version.hash, "old-hash");
    assert.deepEqual(calls, [{ appId: "demo-hello", hash: "old-hash", resourceName: "hello-old-hash" }]);
  } finally {
    await close(server);
  }
});

test("cluster route returns nodes and quorum guidance", async () => {
  const server = await listen({
    cluster: {
      async getCluster() {
        return {
          clusterName: "home-prod",
          summary: { masters: 1, workers: 1, phase: "single-node" },
          nodes: [
            { name: "server-1", role: "master", ready: true, internalIP: "10.0.0.11" },
            { name: "worker-1", role: "worker", ready: true, internalIP: "10.0.0.21" }
          ]
        };
      }
    }
  });

  try {
    const data = await request(server, "/api/cluster");

    assert.equal(data.clusterName, "home-prod");
    assert.equal(data.summary.masters, 1);
    assert.equal(data.nodes.length, 2);
  } finally {
    await close(server);
  }
});

test("join script route returns worker and master install scripts", async () => {
  const scripts = [];
  const server = await listen({
    cluster: {
      async getCluster() {
        return { clusterName: "home-prod", summary: {}, nodes: [] };
      },
      generateJoinScript(options) {
        scripts.push(options);
        return {
          role: options.role,
          script: `#!/usr/bin/env bash\nINSTALL_K3S_EXEC="${options.role === "master" ? "server" : "agent"} --server https://10.0.0.11:6443"`,
          warning: options.role === "master" ? "2 master is not HA" : null
        };
      }
    }
  });

  try {
    const worker = await request(server, "/api/cluster/join-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "worker" })
    });
    const master = await request(server, "/api/cluster/join-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "master" })
    });

    assert.match(worker.script, /agent --server/);
    assert.match(master.script, /server --server/);
    assert.deepEqual(scripts.map((script) => script.role), ["worker", "master"]);
  } finally {
    await close(server);
  }
});

test("join script route rejects unsupported roles", async () => {
  const server = await listen({
    cluster: {
      async getCluster() {
        return { clusterName: "home-prod", summary: {}, nodes: [] };
      },
      generateJoinScript() {
        throw new Error("generate should not run");
      }
    }
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/cluster/join-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "database" })
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /Unsupported node role/);
  } finally {
    await close(server);
  }
});

test("projects route lists the current effective registry", async () => {
  const server = await listen({
    appRegistry: {
      async listApps() {
        return [appConfig, secondAppConfig];
      }
    }
  });

  try {
    const data = await request(server, "/api/projects");

    assert.deepEqual(data.projects.map((project) => project.id), ["demo-hello", "demo-hello-spring"]);
    assert.equal(data.projects[0].gitops.path, "apps/demo-hello/overlays/prod");
  } finally {
    await close(server);
  }
});

test("projects create route delegates to the effective-state registry", async () => {
  const calls = [];
  const server = await listen({
    appRegistry: {
      async listApps() {
        return [appConfig];
      },
      async createApp(input) {
        calls.push(input);
        return secondAppConfig;
      }
    }
  });

  try {
    const data = await request(server, "/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secondAppConfig)
    });

    assert.equal(data.project.id, "demo-hello-spring");
    assert.deepEqual(calls, [secondAppConfig]);
  } finally {
    await close(server);
  }
});

test("projects update route delegates to the effective-state registry", async () => {
  const calls = [];
  const server = await listen({
    appRegistry: {
      async listApps() {
        return [appConfig];
      },
      async updateApp(id, patch) {
        calls.push({ id, patch });
        return { ...appConfig, name: "Demo Hello Updated" };
      }
    }
  });

  try {
    const data = await request(server, "/api/projects/demo-hello", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Demo Hello Updated" })
    });

    assert.equal(data.project.name, "Demo Hello Updated");
    assert.deepEqual(calls, [{ id: "demo-hello", patch: { name: "Demo Hello Updated" } }]);
  } finally {
    await close(server);
  }
});

test("projects delete route delegates to the effective-state registry", async () => {
  const calls = [];
  const server = await listen({
    appRegistry: {
      async listApps() {
        return [appConfig];
      },
      async deleteApp(id) {
        calls.push(id);
        return { deleted: true, id };
      }
    }
  });

  try {
    const data = await request(server, "/api/projects/demo-hello", {
      method: "DELETE"
    });

    assert.equal(data.result.deleted, true);
    assert.deepEqual(calls, ["demo-hello"]);
  } finally {
    await close(server);
  }
});

test("projects source route lists Git-defined projects", async () => {
  const server = await listen({
    sourceProjectRegistry: {
      async listApps() {
        return [appConfig, secondAppConfig];
      }
    }
  });

  try {
    const data = await request(server, "/api/projects/source");

    assert.deepEqual(data.projects.map((project) => project.id), ["demo-hello", "demo-hello-spring"]);
  } finally {
    await close(server);
  }
});

test("projects sync route imports a Git-defined project into the effective registry", async () => {
  const calls = [];
  const server = await listen({
    sourceProjectRegistry: {
      async getApp(id) {
        assert.equal(id, "demo-hello-spring");
        return secondAppConfig;
      }
    },
    appRegistry: {
      async listApps() {
        return [appConfig];
      },
      async syncApp(project) {
        calls.push(project.id);
        return project;
      }
    }
  });

  try {
    const data = await request(server, "/api/projects/demo-hello-spring/sync", {
      method: "POST"
    });

    assert.equal(data.project.id, "demo-hello-spring");
    assert.deepEqual(calls, ["demo-hello-spring"]);
  } finally {
    await close(server);
  }
});

test("version delete route removes an inactive retained revision", async () => {
  const deletions = [];
  const server = await listen({
    rollouts: {
      async getRollout() {
        return {
          status: {
            phase: "Healthy",
            stableRS: "new-hash",
            currentPodHash: "new-hash"
          }
        };
      },
      async getReplicaSets() {
        return [
          {
            metadata: {
              name: "hello-new-hash",
              creationTimestamp: "2026-06-28T00:00:00Z",
              labels: { "rollouts-pod-template-hash": "new-hash" }
            },
            spec: { replicas: 2 },
            status: { replicas: 2, readyReplicas: 2 }
          },
          {
            metadata: {
              name: "hello-old-hash",
              creationTimestamp: "2026-06-27T00:00:00Z",
              labels: { "rollouts-pod-template-hash": "old-hash" }
            },
            spec: { replicas: 0 },
            status: { replicas: 0, readyReplicas: 0 }
          }
        ];
      },
      async deleteReplicaSet(app, replicaSet) {
        deletions.push({ appId: app.id, replicaSet });
        return { deleted: true };
      },
      async runAction() {
        return {};
      }
    }
  });

  try {
    const data = await request(server, "/api/apps/demo-hello/versions/old-hash", {
      method: "DELETE"
    });

    assert.equal(data.result.deleted, true);
    assert.deepEqual(deletions, [{ appId: "demo-hello", replicaSet: "hello-old-hash" }]);
  } finally {
    await close(server);
  }
});

async function listen(overrides = {}) {
  const app = createApp({
    apps: [appConfig],
    appRegistry: overrides.appRegistry,
    sourceProjectRegistry: overrides.sourceProjectRegistry,
    github: overrides.github || {
      async listWorkflowRuns() {
        return [];
      }
    },
    argocd: overrides.argocd || {
      async getApplication() {
        return { status: { sync: { status: "Synced" }, health: { status: "Healthy" } } };
      }
    },
    rollouts: overrides.rollouts || {
      async getRollout() {
        return { status: { phase: "Healthy", stableRS: "stable-hash", currentPodHash: "stable-hash" } };
      },
      async getReplicaSets() {
        return [];
      },
      async deleteReplicaSet() {
        return { deleted: true };
      },
      async runAction() {
        return {};
      }
    },
    releaseManager: overrides.releaseManager || {
      getTask() {
        return null;
      },
      start() {
        return { status: "running", stage: "building" };
      },
      cancel() {
        return { status: "cancelled", stage: "cancelled" };
      }
    },
    cluster: overrides.cluster
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  server.baseUrl = `http://127.0.0.1:${server.address().port}`;
  return server;
}

async function request(server, path, options) {
  const response = await fetch(`${server.baseUrl}${path}`, options);
  const data = await response.json();
  assert.equal(response.ok, true, data.error);
  return data;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
