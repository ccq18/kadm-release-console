import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveReleaseStage,
  localizeActionLabel,
  localizeStatusText,
  nextRefreshDelayMs
} from "../public/release-state.js";

test("shows publish in progress from an active in-memory task", () => {
  const stage = deriveReleaseStage({
    releaseTask: { status: "running", stage: "deploying", message: "正在部署到集群。" },
    argocd: { status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } } },
    rollout: { status: { phase: "Healthy" } },
    workflowRuns: [{ status: "completed", conclusion: "success" }]
  });

  assert.equal(stage.key, "deploying");
  assert.equal(stage.label, "发布中");
  assert.match(stage.description, /正在部署到集群/);
});

test("shows build in progress when workflow is still running", () => {
  const stage = deriveReleaseStage({
    argocd: { status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } } },
    rollout: { status: { phase: "Healthy" } },
    workflowRuns: [{ status: "in_progress", conclusion: null }]
  });

  assert.equal(stage.key, "building");
  assert.equal(stage.label, "构建中");
  assert.match(stage.nextStep, /等待构建完成/);
});

test("shows deploy error when diagnostics already found a blocking release issue", () => {
  const stage = deriveReleaseStage({
    argocd: { status: { sync: { status: "Synced" }, health: { status: "Progressing" } } },
    rollout: { status: { phase: "Progressing" } },
    workflowRuns: [{ status: "completed", conclusion: "success" }],
    diagnostics: {
      summary: { severity: "error", message: 'Error: secret "demo-db" not found' }
    }
  });

  assert.equal(stage.key, "deploy_error");
  assert.equal(stage.label, "部署异常");
  assert.match(stage.description, /secret/);
  assert.match(stage.nextStep, /运行诊断/);
});

test("shows deploy pending after build success but before argocd sync", () => {
  const stage = deriveReleaseStage({
    argocd: { status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } } },
    rollout: { status: { phase: "Healthy" } },
    workflowRuns: [{ status: "completed", conclusion: "success" }]
  });

  assert.equal(stage.key, "deploy_pending");
  assert.equal(stage.label, "待部署");
  assert.match(stage.nextStep, /点发布/);
});

test("shows checking when rollout is paused and waiting for promote", () => {
  const stage = deriveReleaseStage({
    argocd: { status: { sync: { status: "Synced" }, health: { status: "Healthy" } } },
    rollout: {
      spec: {
        strategy: {
          blueGreen: {
            activeService: "hello",
            previewService: "hello-preview",
            autoPromotionEnabled: false
          }
        }
      },
      status: { phase: "Paused", pauseConditions: [{ reason: "BlueGreenPause" }] }
    },
    workflowRuns: [{ status: "completed", conclusion: "success" }]
  });

  assert.equal(stage.key, "checking");
  assert.equal(stage.label, "检查中");
  assert.match(stage.description, /稳定版本/);
  assert.match(stage.nextStep, /版本列表里切换到目标版本/);
});

test("shows released when sync and rollout are both healthy", () => {
  const stage = deriveReleaseStage({
    argocd: {
      status: {
        sync: { status: "Synced" },
        health: { status: "Healthy" },
        operationState: { phase: "Succeeded" }
      }
    },
    rollout: {
      status: {
        phase: "Healthy",
        conditions: [{ type: "Completed", status: "True", reason: "RolloutCompleted" }]
      }
    },
    workflowRuns: [{ status: "completed", conclusion: "success" }]
  });

  assert.equal(stage.key, "released");
  assert.equal(stage.label, "已放量");
  assert.match(stage.nextStep, /当前版本已经完成发布/);
});

test("ignores stale ready task when rollout is healthy and no candidate can be promoted", () => {
  const stage = deriveReleaseStage({
    releaseTask: {
      status: "succeeded",
      stage: "ready",
      message: "发布已稳定，当前没有待放量的金丝雀版本。"
    },
    argocd: {
      status: {
        sync: { status: "Synced" },
        health: { status: "Healthy" },
        operationState: { phase: "Succeeded" }
      }
    },
    rollout: { status: { phase: "Healthy", stableRS: "754d84bf4d", currentPodHash: "754d84bf4d" } },
    workflowRuns: [{ status: "completed", conclusion: "success" }],
    versions: [
      {
        hash: "754d84bf4d",
        role: "stable",
        isStable: true,
        canPromote: false
      }
    ]
  });

  assert.equal(stage.key, "released");
  assert.equal(stage.label, "已放量");
});

test("shows released when rollout is healthy with no candidate even if argocd is out of sync", () => {
  const stage = deriveReleaseStage({
    argocd: {
      status: {
        sync: { status: "OutOfSync" },
        health: { status: "Healthy" },
        operationState: { phase: "Succeeded" }
      }
    },
    rollout: { status: { phase: "Healthy", stableRS: "754d84bf4d", currentPodHash: "754d84bf4d" } },
    workflowRuns: [{ status: "completed", conclusion: "success" }],
    versions: [
      {
        hash: "754d84bf4d",
        role: "stable",
        isStable: true,
        canPromote: false
      }
    ]
  });

  assert.equal(stage.key, "released");
  assert.equal(stage.label, "已放量");
});

test("shows aborted when rollout has been aborted", () => {
  const stage = deriveReleaseStage({
    argocd: { status: { sync: { status: "Synced" }, health: { status: "Degraded" } } },
    rollout: {
      status: {
        phase: "Degraded",
        conditions: [{ type: "Degraded", status: "True", reason: "RolloutAborted" }]
      }
    },
    workflowRuns: [{ status: "completed", conclusion: "success" }]
  });

  assert.equal(stage.key, "aborted");
  assert.equal(stage.label, "已终止");
});

test("localizes actions and common status text", () => {
  assert.equal(localizeActionLabel("release"), "发布");
  assert.equal(localizeActionLabel("promote"), "放量");
  assert.equal(localizeStatusText("Healthy"), "健康");
  assert.equal(localizeStatusText("OutOfSync"), "未部署");
});

test("uses a faster refresh delay while release state can change", () => {
  assert.equal(
    nextRefreshDelayMs({
      releaseTask: { status: "running", stage: "building" },
      rollout: { status: { phase: "Healthy" } },
      versions: []
    }),
    5000
  );
  assert.equal(
    nextRefreshDelayMs({
      rollout: { status: { phase: "Paused" } },
      versions: [{ hash: "candidate", canPromote: true }]
    }),
    5000
  );
});

test("uses a slower refresh delay when state is stable and pauses while hidden", () => {
  const stableStatus = {
    releaseTask: null,
    rollout: { status: { phase: "Healthy" } },
    versions: [{ hash: "stable", canPromote: false }]
  };

  assert.equal(nextRefreshDelayMs(stableStatus), 15000);
  assert.equal(nextRefreshDelayMs(stableStatus, "hidden"), null);
});
