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
  argocd: {
    application: "demo-hello"
  },
  rollout: {
    namespace: "apps",
    name: "hello"
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
      }
    }
  });

  try {
    const data = await request(server, "/api/apps/demo-hello/status");

    assert.equal(data.releaseTask.status, "running");
    assert.deepEqual(data.versions.map((version) => version.hash), ["new-hash", "old-hash"]);
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

test("promote route rejects non-promotable stable version selection", async () => {
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

async function listen(overrides = {}) {
  const app = createApp({
    apps: [appConfig],
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
