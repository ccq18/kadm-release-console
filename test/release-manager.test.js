import test from "node:test";
import assert from "node:assert/strict";
import { ReleaseManager } from "../src/release-manager.js";

const app = {
  id: "demo-hello",
  github: { ref: "main" },
  gitops: { owner: "ccq18", repo: "kadm-app-configs", path: "apps/demo-hello/overlays/prod", image: "ghcr.io/ccq18/demo-hello", ref: "main" }
};

test("runs publish through build, deploy, and canary check", async () => {
  const events = [];
  let runPolls = 0;
  const manager = new ReleaseManager({
    github: {
      async dispatchWorkflow(targetApp, { imageTag }) {
        events.push(`dispatch:${targetApp.id}:${imageTag}`);
        return { dispatched: true };
      },
      async updateGitOpsApp(targetApp, imageTag) {
        events.push(`gitops:${targetApp.id}:${imageTag}`);
        return { updated: true };
      },
      async listWorkflowRuns() {
        events.push("runs");
        runPolls += 1;
        if (runPolls === 1) {
          return [];
        }
        return runPolls === 2
          ? [{ id: 1, status: "queued", conclusion: null, created_at: "2026-06-26T00:00:01.000Z" }]
          : [{ id: 1, status: "completed", conclusion: "success", created_at: "2026-06-26T00:00:01.000Z", head_sha: "abc123456789" }];
      }
    },
    argocd: {
      async syncApplication() {
        events.push("sync");
        return { operation: "started" };
      },
      async getApplication() {
        events.push("app");
        return { status: { sync: { status: "Synced" }, operationState: { phase: "Succeeded" } } };
      }
    },
    rollouts: {
      async getRollout() {
        events.push("rollout");
        return { status: { phase: "Paused", stableRS: "old-hash", currentPodHash: "new-hash" } };
      }
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    pollIntervalMs: 0
  });

  const started = manager.start(app, { imageTag: "sha-abc1234" });
  assert.equal(started.status, "running");
  assert.equal(started.stage, "building");

  const completed = await manager.waitFor(app.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.stage, "ready");
  assert.match(completed.message, /等待放量/);
  assert.deepEqual(events, ["runs", "dispatch:demo-hello:sha-abc1234", "runs", "runs", "gitops:demo-hello:sha-abc1234", "sync", "app", "rollout"]);
});

test("reports blue-green preview waiting for manual traffic switch", async () => {
  let runPolls = 0;
  const manager = new ReleaseManager({
    github: {
      async dispatchWorkflow() {},
      async listWorkflowRuns() {
        runPolls += 1;
        if (runPolls === 1) {
          return [];
        }
        return [{ id: 2, status: "completed", conclusion: "success", head_sha: "abcdef0", created_at: "2026-06-26T00:00:02.000Z" }];
      },
      async updateGitOpsApp() {}
    },
    argocd: {
      async syncApplication() {},
      async getApplication() {
        return {
          status: {
            sync: { status: "Synced" },
            operationState: { phase: "Succeeded" }
          }
        };
      }
    },
    rollouts: {
      async getRollout() {
        return {
          spec: {
            strategy: {
              blueGreen: {
                activeService: "hello",
                previewService: "hello-preview",
                autoPromotionEnabled: false
              }
            }
          },
          status: {
            phase: "Paused",
            pauseConditions: [{ reason: "BlueGreenPause" }]
          }
        };
      }
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    sleep: async () => {}
  });

  const started = manager.start(app);
  await manager.waitFor(app.id);
  const completed = manager.getTask(app.id);

  assert.equal(started.status, "running");
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.stage, "ready");
  assert.match(completed.message, /等待切换流量/);
});

test("waits for the workflow run created by this publish", async () => {
  let runPolls = 0;
  const manager = new ReleaseManager({
    github: {
      async dispatchWorkflow() {
        return { dispatched: true };
      },
      async updateGitOpsApp(_targetApp, imageTag) {
        assert.equal(imageTag, "sha-abcdef0");
        return { updated: true };
      },
      async listWorkflowRuns() {
        runPolls += 1;
        if (runPolls === 1) {
          return [{ id: 1, status: "completed", conclusion: "success", created_at: "2026-06-26T00:00:00.000Z" }];
        }
        if (runPolls === 2) {
          return [{ id: 1, status: "completed", conclusion: "success", created_at: "2026-06-26T00:00:00.000Z" }];
        }
        return [
          { id: 2, status: "completed", conclusion: "success", created_at: "2026-06-26T00:00:02.000Z", head_sha: "abcdef012345" },
          { id: 1, status: "completed", conclusion: "success", created_at: "2026-06-26T00:00:00.000Z" }
        ];
      }
    },
    argocd: {
      async syncApplication() {
        return {};
      },
      async getApplication() {
        return { status: { sync: { status: "Synced" }, operationState: { phase: "Succeeded" } } };
      }
    },
    rollouts: {
      async getRollout() {
        return { status: { phase: "Paused", stableRS: "old-hash", currentPodHash: "new-hash" } };
      }
    },
    now: () => new Date("2026-06-26T00:00:01.000Z"),
    pollIntervalMs: 0
  });

  manager.start(app);
  const completed = await manager.waitFor(app.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(runPolls, 3);
});

test("rejects a second publish while one is already running for the same app", async () => {
  let runPolls = 0;
  const manager = new ReleaseManager({
    github: {
      async dispatchWorkflow() {
        return { dispatched: true };
      },
      async updateGitOpsApp() {
        return { updated: true };
      },
      async listWorkflowRuns() {
        runPolls += 1;
        return runPolls === 1
          ? []
          : [{ id: 1, status: "completed", conclusion: "success", created_at: "2026-06-26T00:00:01.000Z", head_sha: "abcdef012345" }];
      }
    },
    argocd: {
      async syncApplication() {
        return {};
      },
      async getApplication() {
        return { status: { sync: { status: "Synced" }, operationState: { phase: "Running" } } };
      }
    },
    rollouts: {
      async getRollout() {
        return { status: { phase: "Progressing" } };
      }
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    pollIntervalMs: 10,
    deployTimeoutMs: 20
  });

  manager.start(app);
  assert.throws(() => manager.start(app), /already running/);

  const completed = await manager.waitFor(app.id);
  assert.equal(completed.status, "failed");
  assert.match(completed.error, /Timed out/);
});

test("marks publish failed when the build workflow fails", async () => {
  let runPolls = 0;
  const manager = new ReleaseManager({
    github: {
      async dispatchWorkflow() {
        return { dispatched: true };
      },
      async updateGitOpsApp() {
        throw new Error("sync should not run after a failed build");
      },
      async listWorkflowRuns() {
        runPolls += 1;
        if (runPolls === 1) {
          return [];
        }
        return [{ id: 9, status: "completed", conclusion: "failure", created_at: "2026-06-26T00:00:01.000Z" }];
      }
    },
    argocd: {
      async syncApplication() {
        throw new Error("sync should not run after a failed build");
      }
    },
    rollouts: {},
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    pollIntervalMs: 0
  });

  manager.start(app);
  const completed = await manager.waitFor(app.id);

  assert.equal(completed.status, "failed");
  assert.equal(completed.stage, "failed");
  assert.match(completed.error, /Build workflow failed/);
});

test("cancels an in-memory publish task", async () => {
  const manager = new ReleaseManager({
    github: {
      async dispatchWorkflow() {
        return { dispatched: true };
      },
      async updateGitOpsApp() {
        return { updated: true };
      },
      async listWorkflowRuns() {
        return [{ id: 1, status: "queued", conclusion: null, created_at: "2026-06-26T00:00:01.000Z" }];
      }
    },
    argocd: {},
    rollouts: {},
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    pollIntervalMs: 10
  });

  manager.start(app);
  const cancelled = manager.cancel(app.id);
  const completed = await manager.waitFor(app.id);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(completed.status, "cancelled");
  assert.equal(completed.stage, "cancelled");
});
