import {
  deriveReleaseStage,
  localizeActionLabel,
  localizeStatusText,
  nextRefreshDelayMs,
  releaseSteps
} from "./release-state.js";

let apps = [];
let activeAppId = null;
let activeView = "release";
let joinRole = "worker";
let refreshTimer = null;
let isRefreshing = false;

const appList = document.querySelector("#appList");
const appTitle = document.querySelector("#appTitle");
const notice = document.querySelector("#notice");
const clusterNotice = document.querySelector("#clusterNotice");
const imageTagInput = document.querySelector("#imageTagInput");
const versionSelect = document.querySelector("#versionSelect");
const releaseWorkspace = document.querySelector("#releaseWorkspace");
const clusterWorkspace = document.querySelector("#clusterWorkspace");
const clusterNavButton = document.querySelector("#clusterNavButton");
const workerRoleButton = document.querySelector("#workerRoleButton");
const masterRoleButton = document.querySelector("#masterRoleButton");
const joinScript = document.querySelector("#joinScript");
const copyJoinButton = document.querySelector("#copyJoinButton");

document.querySelector("#refreshButton").addEventListener("click", () => refreshStatus());
document.querySelector("#clusterRefreshButton").addEventListener("click", () => refreshCluster());
document.querySelector("#releaseButton").addEventListener("click", () => runAction("release"));
document.querySelector("#promoteButton").addEventListener("click", () => runAction("promote"));
document.querySelector("#cancelReleaseButton").addEventListener("click", () => runAction("release/cancel"));
document.querySelector("#abortButton").addEventListener("click", () => runAction("rollout/abort"));
clusterNavButton.addEventListener("click", () => showClusterView());
workerRoleButton.addEventListener("click", () => selectJoinRole("worker"));
masterRoleButton.addEventListener("click", () => selectJoinRole("master"));
document.querySelector("#generateJoinButton").addEventListener("click", () => generateJoinScript());
copyJoinButton.addEventListener("click", () => copyJoinScript());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    cancelAutoRefresh();
    return;
  }
  if (activeView === "release") {
    refreshStatus({ silent: true });
    return;
  }
  refreshCluster({ silent: true });
});

await init();

async function init() {
  try {
    const data = await api("/api/apps");
    apps = data.apps;
    activeAppId = apps[0]?.id || null;
    renderAppList();
    await refreshStatus();
  } catch (error) {
    notice.textContent = `初始化失败：${error.message}`;
  }
}

function renderAppList() {
  appList.innerHTML = "";
  for (const app of apps) {
    const button = document.createElement("button");
    button.className = "app-button";
    button.type = "button";
    button.textContent = app.name;
    button.setAttribute("aria-current", app.id === activeAppId ? "true" : "false");
    button.addEventListener("click", async () => {
      activeAppId = app.id;
      showReleaseView();
      renderAppList();
      await refreshStatus();
    });
    appList.append(button);
  }
}

function showReleaseView() {
  activeView = "release";
  releaseWorkspace.hidden = false;
  clusterWorkspace.hidden = true;
  clusterNavButton.setAttribute("aria-current", "false");
  renderAppList();
}

async function showClusterView() {
  activeView = "cluster";
  cancelAutoRefresh();
  releaseWorkspace.hidden = true;
  clusterWorkspace.hidden = false;
  clusterNavButton.setAttribute("aria-current", "true");
  renderAppList();
  await refreshCluster();
}

async function refreshStatus({ silent = false } = {}) {
  if (!activeAppId || isRefreshing) {
    return;
  }

  cancelAutoRefresh();
  isRefreshing = true;
  try {
    if (!silent) {
      notice.textContent = "正在刷新状态";
    }
    const status = await api(`/api/apps/${activeAppId}/status`);
    renderStatus(status);
    if (!silent) {
      notice.textContent = "状态已刷新";
    }
    scheduleAutoRefresh(status);
  } catch (error) {
    notice.textContent = `刷新失败：${error.message}`;
    scheduleAutoRefresh(null);
  } finally {
    isRefreshing = false;
  }
}

async function refreshCluster({ silent = false } = {}) {
  cancelAutoRefresh();
  try {
    if (!silent) {
      clusterNotice.textContent = "正在刷新集群";
    }
    const cluster = await api("/api/cluster");
    renderCluster(cluster);
    if (!silent) {
      clusterNotice.textContent = "集群状态已刷新";
    }
  } catch (error) {
    clusterNotice.textContent = `集群刷新失败：${error.message}`;
  }
}

async function runAction(action) {
  if (!activeAppId) {
    return;
  }

  const body = actionBody(action);

  try {
    notice.textContent = `正在${localizeActionLabel(action)}`;
    await api(`/api/apps/${activeAppId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    notice.textContent = `${localizeActionLabel(action)}请求已提交`;
    await refreshStatus();
  } catch (error) {
    notice.textContent = `${localizeActionLabel(action)}失败：${error.message}`;
  }
}

function renderStatus(status) {
  const app = status.app;
  const latestRun = Array.isArray(status.workflowRuns) ? status.workflowRuns[0] : null;
  const stage = deriveReleaseStage(status);
  const versions = Array.isArray(status.versions) ? status.versions : [];

  appTitle.textContent = app.name;
  renderVersions(versions);
  renderStage(stage);
  updateActionStates(stage, status, versions);

  const sync = status.argocd?.status?.sync?.status || status.argocd?.error || "Unknown";
  const health = status.argocd?.status?.health?.status || "Health_unknown";
  const rolloutPhase = status.rollout?.status?.phase || status.rollout?.error || "Unknown";
  const revision = status.rollout?.status?.currentPodHash || status.rollout?.status?.stableRS || "Revision_unknown";
  const candidate = versions.find((version) => version.role === "candidate");
  const stable = versions.find((version) => version.isStable);
  const workflowStatus = latestRun
    ? [localizeStatusText(latestRun.status), localizeStatusText(latestRun.conclusion, "待完成")]
      .filter(Boolean)
      .join(" / ")
    : "暂无构建";

  document.querySelector("#syncState").textContent = localizeStatusText(sync);
  document.querySelector("#healthState").textContent = localizeStatusText(health);
  document.querySelector("#rolloutPhase").textContent = localizeStatusText(rolloutPhase);
  document.querySelector("#rolloutRevision").textContent = revision;
  document.querySelector("#workflowStatus").textContent = workflowStatus;
  document.querySelector("#workflowBranch").textContent = latestRun?.head_branch || app.github.ref || "分支未知";
  document.querySelector("#candidateVersion").textContent = candidate?.hash || "无候选版本";
  document.querySelector("#stableVersion").textContent = stable ? `稳定 ${stable.hash}` : "稳定版本未知";

  document.querySelector("#appDetails").innerHTML = detailRows({
    代码仓库: `${app.github.owner}/${app.github.repo}`,
    工作流: app.github.workflow,
    分支: app.github.ref,
    ArgoCD_应用: app.argocd.application,
    Rollout: `${app.rollout.namespace}/${app.rollout.name}`
  });

  document.querySelector("#workflowDetails").textContent = JSON.stringify(latestRun || status.workflowRuns, null, 2);
  document.querySelector("#versionDetails").textContent = JSON.stringify(versions, null, 2);
  document.querySelector("#rolloutDetails").textContent = JSON.stringify(status.rollout?.status || status.rollout, null, 2);
}

function renderCluster(cluster) {
  const summary = cluster.summary || {};
  const nodes = Array.isArray(cluster.nodes) ? cluster.nodes : [];
  document.querySelector("#clusterTitle").textContent = cluster.clusterName || "集群节点";
  document.querySelector("#masterCount").textContent = summary.masters ?? 0;
  document.querySelector("#workerCount").textContent = summary.workers ?? 0;
  document.querySelector("#readyCount").textContent = `${summary.ready ?? 0}/${summary.total ?? nodes.length} Ready`;
  document.querySelector("#clusterPhase").textContent = localizeClusterPhase(summary.phase);
  document.querySelector("#clusterGuidanceTitle").textContent = guidanceTitle(summary.phase);
  document.querySelector("#clusterGuidance").textContent = summary.guidance || "暂无建议";
  document.querySelector("#nodeCount").textContent = nodes.length;
  document.querySelector("#nodeList").innerHTML = nodes.length
    ? nodes.map(nodeMarkup).join("")
    : `<p class="empty-state">暂无节点数据</p>`;
}

function nodeMarkup(node) {
  const role = node.role === "master" ? "Master" : "Worker";
  const ready = node.ready ? "Ready" : "NotReady";
  return `<article class="node-row">
    <div>
      <strong>${escapeHtml(node.name)}</strong>
      <span>${escapeHtml(role)} / ${escapeHtml(ready)}</span>
    </div>
    <dl>
      <dt>内网</dt><dd>${escapeHtml(node.internalIP || "-")}</dd>
      <dt>版本</dt><dd>${escapeHtml(node.kubeletVersion || "-")}</dd>
    </dl>
  </article>`;
}

function selectJoinRole(role) {
  joinRole = role;
  workerRoleButton.setAttribute("aria-pressed", role === "worker" ? "true" : "false");
  masterRoleButton.setAttribute("aria-pressed", role === "master" ? "true" : "false");
  joinScript.textContent = "选择角色后生成加入脚本。";
  document.querySelector("#joinWarning").textContent = "";
  copyJoinButton.disabled = true;
}

async function generateJoinScript() {
  try {
    clusterNotice.textContent = "正在生成加入脚本";
    const result = await api("/api/cluster/join-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: joinRole })
    });
    joinScript.textContent = result.script;
    document.querySelector("#joinWarning").textContent = result.warning || "";
    copyJoinButton.disabled = false;
    clusterNotice.textContent = "加入脚本已生成";
  } catch (error) {
    clusterNotice.textContent = `生成失败：${error.message}`;
  }
}

async function copyJoinScript() {
  try {
    await navigator.clipboard.writeText(joinScript.textContent);
    clusterNotice.textContent = "脚本已复制";
  } catch (_error) {
    clusterNotice.textContent = "复制失败，请手动选择脚本";
  }
}

function renderStage(stage) {
  document.querySelector("#stageLabel").textContent = stage.label;
  document.querySelector("#stageDescription").textContent = stage.description;
  document.querySelector("#stageNextStep").textContent = `下一步：${stage.nextStep}`;
  document.querySelector("#stageSteps").innerHTML = releaseSteps()
    .map((label, index) => stageStepMarkup(label, index, stage))
    .join("");
}

function stageStepMarkup(label, index, stage) {
  const current = stage.index === index;
  const done = stage.index > index;
  const isErrorStage = ["aborted", "cancelled", "release_failed", "build_failed"].includes(stage.key);
  const state = isErrorStage && current
    ? "error"
    : current
      ? "current"
      : done
        ? "done"
        : "upcoming";
  const stateText = current
    ? stage.label
    : done
      ? "已完成"
      : "未开始";

  return `<li class="stage-step" data-state="${escapeHtml(state)}">
    <span class="stage-step-index">步骤 ${index + 1}</span>
    <strong class="stage-step-label">${escapeHtml(label)}</strong>
    <span class="stage-step-state">${escapeHtml(stateText)}</span>
  </li>`;
}

function renderVersions(versions) {
  const previousValue = versionSelect.value;
  const promotable = versions.filter((version) => version.canPromote);
  versionSelect.innerHTML = "";

  if (versions.length === 0) {
    versionSelect.append(new Option("暂无版本", ""));
    versionSelect.disabled = true;
    return;
  }

  for (const version of versions) {
    const label = `${version.label || version.role} ${version.hash}${version.canPromote ? "（可放量）" : ""}`;
    const option = new Option(label, version.hash);
    option.disabled = !version.canPromote;
    versionSelect.append(option);
  }

  const preferred = promotable.find((version) => version.hash === previousValue) || promotable[0];
  versionSelect.value = preferred?.hash || "";
  versionSelect.disabled = promotable.length === 0;
}

function updateActionStates(stage, status, versions) {
  const releaseButton = document.querySelector("#releaseButton");
  const promoteButton = document.querySelector("#promoteButton");
  const cancelReleaseButton = document.querySelector("#cancelReleaseButton");
  const abortButton = document.querySelector("#abortButton");
  const releaseRunning = status.releaseTask?.status === "running";
  const hasPromotableVersion = versions.some((version) => version.canPromote);
  const rolloutPhase = status.rollout?.status?.phase || null;
  const rolloutBusy = rolloutPhase === "Paused" || rolloutPhase === "Progressing";

  imageTagInput.disabled = releaseRunning;
  releaseButton.disabled = releaseRunning || hasPromotableVersion || rolloutPhase === "Progressing";
  promoteButton.disabled = releaseRunning || !hasPromotableVersion;
  cancelReleaseButton.disabled = !releaseRunning;
  abortButton.disabled = releaseRunning || !(hasPromotableVersion || rolloutBusy || stage.key === "checking");
}

function actionBody(action) {
  if (action === "release" && imageTagInput.value.trim()) {
    return { imageTag: imageTagInput.value.trim() };
  }
  if (action === "promote" && versionSelect.value) {
    return { versionHash: versionSelect.value };
  }
  return {};
}

function scheduleAutoRefresh(status) {
  const delay = nextRefreshDelayMs(status || {}, document.visibilityState);
  if (delay === null) {
    return;
  }

  refreshTimer = window.setTimeout(() => {
    refreshStatus({ silent: true });
  }, delay);
}

function cancelAutoRefresh() {
  if (!refreshTimer) {
    return;
  }
  window.clearTimeout(refreshTimer);
  refreshTimer = null;
}

function detailRows(rows) {
  return Object.entries(rows)
    .map(([key, value]) => `<dt>${escapeHtml(key.replaceAll("_", " "))}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

function localizeClusterPhase(phase) {
  const labels = {
    "single-node": "单 Master",
    "two-master-not-ha": "双 Master 非 HA",
    "ha-recommended": "三 Master HA",
    "ha-advanced": "高级 HA",
    "nonstandard-master-count": "非标准控制面"
  };
  return labels[phase] || "状态未知";
}

function guidanceTitle(phase) {
  if (phase === "two-master-not-ha") {
    return "继续加入第三个 Master";
  }
  if (phase === "ha-recommended") {
    return "优先添加 Worker";
  }
  if (phase === "single-node") {
    return "单节点起步";
  }
  return "检查拓扑";
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || response.statusText);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
