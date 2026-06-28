const STATUS_LABELS = {
  Unknown: "未知",
  Health_unknown: "健康状态未知",
  Revision_unknown: "版本未知",
  Branch_unknown: "分支未知",
  Healthy: "健康",
  Degraded: "异常",
  Progressing: "进行中",
  Suspended: "已暂停",
  Paused: "已暂停",
  Synced: "已部署",
  OutOfSync: "未部署",
  Running: "运行中",
  Succeeded: "成功",
  Failed: "失败",
  Error: "错误",
  completed: "已完成",
  in_progress: "进行中",
  queued: "排队中",
  requested: "已请求",
  waiting: "等待中",
  pending: "等待中",
  success: "成功",
  failure: "失败",
  cancelled: "已取消",
  skipped: "已跳过",
  neutral: "无结果",
  stale: "已过期",
  action_required: "待处理"
};

const ACTION_LABELS = {
  release: "发布",
  "release/cancel": "取消发布",
  promote: "放量",
  build: "构建",
  sync: "部署",
  "rollout/promote": "放量",
  "rollout/abort": "终止",
  "rollout/restart": "重启"
};

const STAGE_STEPS = ["构建", "部署", "检查", "放量"];
const FAST_REFRESH_MS = 5000;
const STABLE_REFRESH_MS = 15000;

export function localizeStatusText(value, fallback = "未知") {
  if (!value) {
    return fallback;
  }
  return STATUS_LABELS[value] || value;
}

export function localizeActionLabel(action) {
  return ACTION_LABELS[action] || action;
}

export function releaseSteps() {
  return STAGE_STEPS.slice();
}

export function deriveReleaseStage(status) {
  const taskStage = deriveTaskStage(status.releaseTask, status);
  if (taskStage) {
    return taskStage;
  }

  const latestRun = Array.isArray(status.workflowRuns) ? status.workflowRuns[0] : null;
  const syncStatus = status.argocd?.status?.sync?.status || null;
  const operationPhase = status.argocd?.status?.operationState?.phase || null;
  const rolloutStatus = status.rollout?.status || {};
  const rolloutPhase = rolloutStatus.phase || null;
  const pauseConditions = Array.isArray(rolloutStatus.pauseConditions)
    ? rolloutStatus.pauseConditions
    : [];
  const conditions = Array.isArray(rolloutStatus.conditions) ? rolloutStatus.conditions : [];
  const latestRunDone = latestRun?.status === "completed";
  const latestRunSucceeded = latestRunDone && latestRun?.conclusion === "success";
  const latestRunFailed = latestRunDone && latestRun?.conclusion && latestRun?.conclusion !== "success";
  const isPaused = rolloutPhase === "Paused" || pauseConditions.length > 0;
  const isAborted = conditions.some((condition) => String(condition.reason || "").includes("Aborted"));
  const blockingDiagnostic = getBlockingDiagnostic(status);
  const strategyMode = deriveStrategyMode(status.rollout);
  const isHealthyRelease = syncStatus === "Synced" && rolloutPhase === "Healthy";
  const hasStableHealthyVersion = rolloutPhase === "Healthy" && hasNoPromotableCandidate(status);

  if (latestRun && !latestRunDone) {
    return stage("building", 0, "构建中", "GitHub Actions 正在构建镜像。", "等待构建完成，发布流水线会继续完成部署和检查。");
  }

  if (latestRunFailed) {
    return stage("build_failed", 0, "构建失败", "最近一次构建没有成功。", "先看最近构建日志，修完后重新点发布。");
  }

  if (isAborted) {
    return stage("aborted", 2, "已终止", "本次发布已经被终止。", "排查原因后重新构建，或点重启重发当前版本。");
  }

  if (blockingDiagnostic) {
    return stage(
      "deploy_error",
      isPaused ? 2 : 1,
      "部署异常",
      blockingDiagnostic.message,
      "先看运行诊断里的 Pod、事件和日志，修复配置或依赖后再重新发布。"
    );
  }

  if (operationPhase === "Running") {
    return stage("deploying", 1, "部署中", "Argo CD 正在把目标版本下发到集群。", "等待部署完成，再检查 Pod 和健康状态。");
  }

  if (hasStableHealthyVersion) {
    return stage("released", 3, "已放量", "当前稳定版本已经部署完成并健康运行。", "有新代码时点发布；如果部署状态未同步，可以先刷新或查看 Argo CD 差异。");
  }

  if (latestRunSucceeded && syncStatus === "OutOfSync") {
    return stage("deploy_pending", 1, "待部署", "新镜像已经构建完成，但还没有部署到集群。", "点发布，KADM 会继续完成部署和检查。");
  }

  if (isPaused) {
    if (strategyMode === "blueGreen") {
      return stage(
        "checking",
        2,
        "检查中",
        "新版本已经完成预发布，当前稳定版本仍在接流量。",
        "确认正常后在版本列表里切换到目标版本；有问题就点终止。"
      );
    }
    return stage("checking", 2, "检查中", "新版本已经进到金丝雀阶段，正在等待人工确认。", "确认正常后在版本列表里切换到目标版本；有问题就点终止。");
  }

  if (syncStatus === "Synced" && rolloutPhase && rolloutPhase !== "Healthy") {
    return stage("deploying", 1, "部署中", "版本已经开始发布，但 Rollout 还没稳定。", "继续观察 Rollout、Pod 和健康检查。");
  }

  if (isHealthyRelease) {
    return stage("released", 3, "已放量", "当前版本已经部署完成并稳定运行。", "当前版本已经完成发布；有新代码时点发布。");
  }

  if (syncStatus === "OutOfSync") {
    return stage("build_pending", 0, "待发布", "当前还没有新的发布动作。", "有新代码点发布，KADM 会自动完成构建、部署和检查。");
  }

  return stage("unknown", 0, "状态待确认", "还没有足够的信息判断当前发布步骤。", "先点刷新状态，确认构建、部署和 Rollout 信息。");
}

export function nextRefreshDelayMs(status, visibilityState = "visible") {
  if (visibilityState === "hidden") {
    return null;
  }

  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const rolloutPhase = status?.rollout?.status?.phase || null;
  const releaseRunning = status?.releaseTask?.status === "running";
  const hasPromotableVersion = versions.some((version) => version.canPromote);
  const rolloutCanChangeSoon = rolloutPhase === "Progressing" || rolloutPhase === "Paused";

  return releaseRunning || hasPromotableVersion || rolloutCanChangeSoon
    ? FAST_REFRESH_MS
    : STABLE_REFRESH_MS;
}

function deriveTaskStage(task, status) {
  if (!task) {
    return null;
  }

  const blockingDiagnostic = getBlockingDiagnostic(status);

  if (task.status === "running") {
    if (task.stage !== "building" && blockingDiagnostic) {
      return stage(
        "deploy_error",
        task.stage === "ready" ? 2 : 1,
        "部署异常",
        blockingDiagnostic.message,
        "先看运行诊断里的 Pod、事件和日志，修复配置或依赖后再重新发布。"
      );
    }
    const index = task.stage === "building" ? 0 : task.stage === "deploying" ? 1 : 2;
    return stage(
      task.stage || "release_running",
      index,
      "发布中",
      task.message || "发布流水线正在运行。",
      "等待发布完成检查后再放量。"
    );
  }

  if (task.status === "succeeded" && task.stage === "ready") {
    if (hasNoPromotableCandidate(status)) {
      return null;
    }
    return stage(
      "checking",
      2,
      "待放量",
      task.message || "发布已完成构建、部署和检查。",
      "确认正常后点放量；有问题就点终止。"
    );
  }

  if (task.status === "failed") {
    return stage(
      "release_failed",
      task.stage === "building" ? 0 : task.stage === "deploying" ? 1 : 2,
      "发布失败",
      task.error || task.message || "发布流水线没有成功完成。",
      "修复问题后重新点发布。"
    );
  }

  if (task.status === "cancelled") {
    return stage("cancelled", 1, "已取消", task.message || "发布任务已取消。", "需要发布时重新点发布。");
  }

  return null;
}

function hasNoPromotableCandidate(status) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const versionsProveNoCandidate = versions.length > 0 && versions.every((version) => !version.canPromote);

  return versionsProveNoCandidate;
}

function getBlockingDiagnostic(status) {
  const summary = status?.diagnostics?.summary;
  return summary?.severity === "error" ? summary : null;
}

function deriveStrategyMode(rollout) {
  if (rollout?.spec?.strategy?.blueGreen) {
    return "blueGreen";
  }
  return "canary";
}

function stage(key, index, label, description, nextStep) {
  return { key, index, label, description, nextStep };
}
