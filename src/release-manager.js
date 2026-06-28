const DEFAULT_BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const WORKFLOW_CLOCK_SKEW_MS = 60 * 1000;

class CancellationError extends Error {
  constructor() {
    super("Release task cancelled.");
    this.name = "CancellationError";
  }
}

export class ReleaseManager {
  constructor({
    github,
    argocd,
    rollouts,
    now = () => new Date(),
    sleep = defaultSleep,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    buildTimeoutMs = DEFAULT_BUILD_TIMEOUT_MS,
    deployTimeoutMs = DEFAULT_DEPLOY_TIMEOUT_MS
  }) {
    this.github = github;
    this.argocd = argocd;
    this.rollouts = rollouts;
    this.now = now;
    this.sleep = sleep;
    this.pollIntervalMs = pollIntervalMs;
    this.buildTimeoutMs = buildTimeoutMs;
    this.deployTimeoutMs = deployTimeoutMs;
    this.tasks = new Map();
  }

  start(app, { imageTag } = {}) {
    const existing = this.tasks.get(app.id);
    if (isRunning(existing)) {
      const error = new Error(`Release already running for app: ${app.id}`);
      error.status = 409;
      throw error;
    }

    const task = {
      id: `${app.id}-${Date.now()}`,
      appId: app.id,
      status: "running",
      stage: "building",
      message: "正在触发构建工作流。",
      imageTag: imageTag || null,
      cancelRequested: false,
      startedAt: this.timestamp(),
      updatedAt: this.timestamp(),
      completedAt: null,
      error: null,
      promise: null
    };
    task.promise = this.runTask(task, app, { imageTag });
    this.tasks.set(app.id, task);
    return snapshotTask(task);
  }

  getTask(appId) {
    const task = this.tasks.get(appId);
    return task ? snapshotTask(task) : null;
  }

  cancel(appId) {
    const task = this.tasks.get(appId);
    if (!isRunning(task)) {
      const error = new Error(`No running release for app: ${appId}`);
      error.status = 404;
      throw error;
    }

    task.cancelRequested = true;
    this.markCancelled(task);
    return snapshotTask(task);
  }

  async waitFor(appId) {
    const task = this.tasks.get(appId);
    if (!task) {
      const error = new Error(`No release task for app: ${appId}`);
      error.status = 404;
      throw error;
    }
    if (task.promise) {
      await task.promise;
    }
    return snapshotTask(task);
  }

  async runTask(task, app, { imageTag }) {
    try {
      this.assertContinuing(task);
      const knownWorkflowRunIds = await this.listKnownWorkflowRunIds(app);
      this.assertContinuing(task);
      await this.github.dispatchWorkflow(app, { imageTag });

      this.updateTask(task, {
        stage: "building",
        message: "构建已触发，正在等待 GitHub Actions 完成。"
      });
      const buildRun = await this.waitForBuild(task, app, knownWorkflowRunIds);
      const resolvedImageTag = imageTag || inferImageTag(buildRun);

      this.updateTask(task, {
        stage: "deploying",
        message: "构建成功，正在更新 GitOps 并同步 Argo CD。"
      });
      this.assertContinuing(task);
      await this.github.updateGitOpsApp(app, resolvedImageTag);
      this.assertContinuing(task);
      await this.argocd.syncApplication(app);

      this.updateTask(task, {
        stage: "checking",
        message: "部署已触发，正在等待 Rollout 进入检查阶段。"
      });
      const result = await this.waitForCanaryCheck(task, app);

      this.markSucceeded(task, {
        stage: result.stage,
        message: result.message
      });
    } catch (error) {
      if (error instanceof CancellationError || task.cancelRequested || task.status === "cancelled") {
        this.markCancelled(task);
        return;
      }
      this.markFailed(task, error);
    }
  }

  async waitForBuild(task, app, ignoredRunIds = new Set()) {
    const deadline = Date.now() + this.buildTimeoutMs;
    const startedAfter = Date.parse(task.startedAt) - WORKFLOW_CLOCK_SKEW_MS;

    while (Date.now() <= deadline) {
      this.assertContinuing(task);
      const runs = await this.github.listWorkflowRuns(app);
      const run = selectWorkflowRun(runs, startedAfter, ignoredRunIds);

      if (!run) {
        this.updateTask(task, {
          stage: "building",
          message: "构建已触发，正在等待新的工作流运行出现。"
        });
        await this.pause();
        continue;
      }

      if (run.status !== "completed") {
        this.updateTask(task, {
          stage: "building",
          message: `构建运行 ${run.id || ""} ${run.status || "进行中"}。`.trim()
        });
        await this.pause();
        continue;
      }

      if (run.conclusion === "success") {
        return run;
      }

      throw new Error(`Build workflow failed with conclusion: ${run.conclusion || "unknown"}`);
    }

    throw new Error("Timed out waiting for build workflow to finish.");
  }

  async waitForCanaryCheck(task, app) {
    const deadline = Date.now() + this.deployTimeoutMs;

    while (Date.now() <= deadline) {
      this.assertContinuing(task);
      const [application, rollout] = await Promise.all([
        this.argocd.getApplication(app),
        this.rollouts.getRollout(app)
      ]);
      const appStatus = application?.status || {};
      const rolloutStatus = rollout?.status || {};
      const syncStatus = appStatus.sync?.status || null;
      const operationPhase = appStatus.operationState?.phase || null;
      const rolloutPhase = rolloutStatus.phase || null;

      if (isAborted(rolloutStatus)) {
        throw new Error("Rollout has been aborted.");
      }

      if (rolloutPhase === "Degraded") {
        throw new Error("Rollout is degraded.");
      }

      if (isPaused(rolloutStatus)) {
        return {
          stage: "ready",
          message: isBlueGreen(rollout)
            ? "发布已完成构建与预发布检查，当前稳定版本仍在接流量，正在等待切换流量。"
            : "发布已完成构建、部署和检查，正在等待放量。"
        };
      }

      if (syncStatus === "Synced" && rolloutPhase === "Healthy") {
        return {
          stage: "ready",
          message: "发布已稳定，当前没有待放量的金丝雀版本。"
        };
      }

      this.updateTask(task, {
        stage: operationPhase === "Running" || syncStatus !== "Synced" ? "deploying" : "checking",
        message: describeDeployWait(syncStatus, operationPhase, rolloutPhase)
      });
      await this.pause();
    }

    throw new Error("Timed out waiting for rollout to enter canary check.");
  }

  async listKnownWorkflowRunIds(app) {
    const runs = await this.github.listWorkflowRuns(app);
    if (!Array.isArray(runs)) {
      return new Set();
    }
    return new Set(
      runs
        .map((run) => run.id)
        .filter((id) => id !== null && id !== undefined)
        .map(String)
    );
  }

  assertContinuing(task) {
    if (task.cancelRequested || task.status === "cancelled") {
      throw new CancellationError();
    }
  }

  updateTask(task, patch) {
    if (!isRunning(task)) {
      return;
    }
    if (patch.stage || patch.message) {
      console.log(
        JSON.stringify({
          type: "release-task",
          at: this.timestamp(),
          appId: task.appId,
          taskId: task.id,
          stage: patch.stage || task.stage,
          message: patch.message || task.message,
          status: task.status
        })
      );
    }
    Object.assign(task, patch, { updatedAt: this.timestamp() });
  }

  markSucceeded(task, patch) {
    if (!isRunning(task)) {
      return;
    }
    Object.assign(task, patch, {
      status: "succeeded",
      completedAt: this.timestamp(),
      updatedAt: this.timestamp()
    });
  }

  markFailed(task, error) {
    if (!isRunning(task)) {
      return;
    }
    Object.assign(task, {
      status: "failed",
      stage: "failed",
      message: "发布失败。",
      error: error.message || String(error),
      completedAt: this.timestamp(),
      updatedAt: this.timestamp()
    });
  }

  markCancelled(task) {
    Object.assign(task, {
      status: "cancelled",
      stage: "cancelled",
      message: "发布任务已取消。",
      completedAt: task.completedAt || this.timestamp(),
      updatedAt: this.timestamp()
    });
  }

  async pause() {
    await this.sleep(this.pollIntervalMs);
  }

  timestamp() {
    return this.now().toISOString();
  }
}

function selectWorkflowRun(runs, startedAfter, ignoredRunIds) {
  if (!Array.isArray(runs)) {
    return null;
  }

  return runs.find((run) => {
    if (run.id !== null && run.id !== undefined && ignoredRunIds.has(String(run.id))) {
      return false;
    }
    if (!run.created_at) {
      return true;
    }
    const createdAt = Date.parse(run.created_at);
    return Number.isNaN(createdAt) || createdAt >= startedAfter;
  }) || null;
}

function describeDeployWait(syncStatus, operationPhase, rolloutPhase) {
  if (operationPhase === "Running") {
    return "Argo CD 正在同步目标版本。";
  }
  if (syncStatus !== "Synced") {
    return "等待 Argo CD 同步完成。";
  }
  if (rolloutPhase) {
    return `等待 Rollout 进入检查阶段，当前状态为 ${rolloutPhase}。`;
  }
  return "等待 Rollout 状态刷新。";
}

function isPaused(status) {
  return status.phase === "Paused" || (Array.isArray(status.pauseConditions) && status.pauseConditions.length > 0);
}

function isBlueGreen(rollout) {
  return Boolean(rollout?.spec?.strategy?.blueGreen);
}

function isAborted(status) {
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  return conditions.some((condition) => String(condition.reason || "").includes("Aborted"));
}

function isRunning(task) {
  return task?.status === "running";
}

function snapshotTask(task) {
  return {
    id: task.id,
    appId: task.appId,
    status: task.status,
    stage: task.stage,
    message: task.message,
    imageTag: task.imageTag,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    error: task.error
  };
}

function inferImageTag(run) {
  const sha = run?.head_sha || run?.headSha || "";
  if (sha.length >= 7) {
    return `sha-${sha.slice(0, 7)}`;
  }
  throw new Error("Build workflow finished without a usable head SHA.");
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
