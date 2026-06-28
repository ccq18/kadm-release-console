import {
  deriveReleaseStage,
  localizeActionLabel,
  localizeStatusText,
  nextRefreshDelayMs,
  releaseSteps
} from "./release-state.js";
import { diagnosticSurfaceState, renderDiagnosticsMarkup } from "./diagnostics-view.js";

let apps = [];
let effectiveProjects = [];
let sourceProjects = [];
let activeAppId = null;
let activeProjectId = null;
let activeView = "release";
let joinRole = "worker";
let refreshTimer = null;
let isRefreshing = false;

const appList = document.querySelector("#appList");
const appTitle = document.querySelector("#appTitle");
const notice = document.querySelector("#notice");
const clusterNotice = document.querySelector("#clusterNotice");
const projectNotice = document.querySelector("#projectNotice");
const imageTagInput = document.querySelector("#imageTagInput");
const versionInventory = document.querySelector("#versionInventory");
const releaseWorkspace = document.querySelector("#releaseWorkspace");
const clusterWorkspace = document.querySelector("#clusterWorkspace");
const projectWorkspace = document.querySelector("#projectWorkspace");
const clusterNavButton = document.querySelector("#clusterNavButton");
const projectNavButton = document.querySelector("#projectNavButton");
const workerRoleButton = document.querySelector("#workerRoleButton");
const masterRoleButton = document.querySelector("#masterRoleButton");
const joinScript = document.querySelector("#joinScript");
const copyJoinButton = document.querySelector("#copyJoinButton");
const projectList = document.querySelector("#projectList");
const sourceProjectList = document.querySelector("#sourceProjectList");
const projectCount = document.querySelector("#projectCount");
const sourceProjectCount = document.querySelector("#sourceProjectCount");
const selectedProjectTitle = document.querySelector("#selectedProjectTitle");
const projectDetails = document.querySelector("#projectDetails");
const projectSyncButton = document.querySelector("#projectSyncButton");
const projectDeleteButton = document.querySelector("#projectDeleteButton");

document.querySelector("#refreshButton").addEventListener("click", () => refreshStatus());
document.querySelector("#clusterRefreshButton").addEventListener("click", () => refreshCluster());
document.querySelector("#projectRefreshButton").addEventListener("click", () => refreshProjectsRegistry());
document.querySelector("#releaseButton").addEventListener("click", () => runAction("release"));
document.querySelector("#cancelReleaseButton").addEventListener("click", () => runAction("release/cancel"));
document.querySelector("#abortButton").addEventListener("click", () => runAction("rollout/abort"));
clusterNavButton.addEventListener("click", () => showClusterView());
projectNavButton.addEventListener("click", () => showProjectView());
workerRoleButton.addEventListener("click", () => selectJoinRole("worker"));
masterRoleButton.addEventListener("click", () => selectJoinRole("master"));
document.querySelector("#generateJoinButton").addEventListener("click", () => generateJoinScript());
copyJoinButton.addEventListener("click", () => copyJoinScript());
projectSyncButton.addEventListener("click", () => syncSelectedProject());
projectDeleteButton.addEventListener("click", () => deleteSelectedProject());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    cancelAutoRefresh();
    return;
  }
  if (activeView === "release") {
    refreshStatus({ silent: true });
    return;
  }
  if (activeView === "projects") {
    refreshProjectsRegistry({ silent: true });
    return;
  }
  refreshCluster({ silent: true });
});

await init();

async function init() {
  try {
    await refreshProjectsRegistry({ silent: true, preserveSelection: false });
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
  projectWorkspace.hidden = true;
  clusterNavButton.setAttribute("aria-current", "false");
  projectNavButton.setAttribute("aria-current", "false");
  renderAppList();
}

async function showClusterView() {
  activeView = "cluster";
  cancelAutoRefresh();
  releaseWorkspace.hidden = true;
  clusterWorkspace.hidden = false;
  projectWorkspace.hidden = true;
  clusterNavButton.setAttribute("aria-current", "true");
  projectNavButton.setAttribute("aria-current", "false");
  renderAppList();
  await refreshCluster();
}

async function showProjectView() {
  activeView = "projects";
  cancelAutoRefresh();
  releaseWorkspace.hidden = true;
  clusterWorkspace.hidden = true;
  projectWorkspace.hidden = false;
  clusterNavButton.setAttribute("aria-current", "false");
  projectNavButton.setAttribute("aria-current", "true");
  renderAppList();
  await refreshProjectsRegistry();
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

async function refreshProjectsRegistry({ silent = false, preserveSelection = true } = {}) {
  try {
    if (!silent) {
      projectNotice.textContent = "正在刷新项目";
    }
    const [effectiveData, sourceData] = await Promise.all([
      api("/api/projects"),
      api("/api/projects/source")
    ]);

    effectiveProjects = effectiveData.projects || [];
    sourceProjects = sourceData.projects || [];
    apps = effectiveProjects.map(projectToApp);

    if (!preserveSelection || !sourceProjects.some((project) => project.id === activeProjectId)) {
      activeProjectId = sourceProjects[0]?.id || null;
    }
    if (!apps.some((app) => app.id === activeAppId)) {
      activeAppId = apps[0]?.id || null;
    }

    renderAppList();
    renderEffectiveProjectList();
    renderSourceProjectList();
    renderProjectDetails();

    if (!silent) {
      projectNotice.textContent = "项目已刷新";
    }
  } catch (error) {
    projectNotice.textContent = `项目刷新失败：${error.message}`;
  }
}

function renderEffectiveProjectList() {
  projectCount.textContent = String(effectiveProjects.length);
  projectList.innerHTML = effectiveProjects.length
    ? effectiveProjects
        .map(
          (project) => `<button class="project-row" type="button" data-effective-project-id="${escapeHtml(project.id)}" aria-current="${project.id === activeProjectId ? "true" : "false"}">
    <strong>${escapeHtml(project.name)}</strong>
    <small>已生效 / ${escapeHtml(project.id)} / ${escapeHtml(project.argocd.application)}</small>
  </button>`
        )
        .join("")
    : `<p class="empty-state">当前没有生效中的项目。</p>`;

  for (const button of projectList.querySelectorAll("[data-effective-project-id]")) {
    button.addEventListener("click", () => {
      activeProjectId = button.getAttribute("data-effective-project-id");
      renderEffectiveProjectList();
      renderSourceProjectList();
      renderProjectDetails();
    });
  }
}

function renderSourceProjectList() {
  const effectiveIds = new Set(effectiveProjects.map((project) => project.id));
  sourceProjectCount.textContent = String(sourceProjects.length);
  sourceProjectList.innerHTML = sourceProjects.length
    ? sourceProjects
        .map((project) => {
          const isEffective = effectiveIds.has(project.id);
          return `<button class="project-row" type="button" data-source-project-id="${escapeHtml(project.id)}" aria-current="${project.id === activeProjectId ? "true" : "false"}">
    <strong>${escapeHtml(project.name)}</strong>
    <small>${isEffective ? "Git 已定义 / 系统已生效" : "Git 已定义 / 尚未生效"}</small>
  </button>`;
        })
        .join("")
    : `<p class="empty-state">Git 中暂无项目定义。</p>`;

  for (const button of sourceProjectList.querySelectorAll("[data-source-project-id]")) {
    button.addEventListener("click", () => {
      activeProjectId = button.getAttribute("data-source-project-id");
      renderEffectiveProjectList();
      renderSourceProjectList();
      renderProjectDetails();
    });
  }
}

function renderProjectDetails() {
  const sourceProject = sourceProjects.find((project) => project.id === activeProjectId) || null;
  const effectiveProject = effectiveProjects.find((project) => project.id === activeProjectId) || null;
  const project = sourceProject || effectiveProject;

  if (!project) {
    selectedProjectTitle.textContent = "当前选择";
    projectDetails.innerHTML = `<dt>状态</dt><dd>未选择项目</dd>`;
    projectSyncButton.disabled = true;
    projectDeleteButton.disabled = true;
    return;
  }

  selectedProjectTitle.textContent = `${project.name} / ${project.id}`;
  projectDetails.innerHTML = detailRows({
    生效状态: effectiveProject ? "已在系统生效" : "仅在 Git 定义",
    源码仓库: `${project.github.owner}/${project.github.repo}`,
    Workflow: project.github.workflow,
    源码分支: project.github.ref,
    GitOps_仓库: `${project.gitops.owner}/${project.gitops.repo}`,
    GitOps_路径: project.gitops.path,
    镜像: project.gitops.image,
    GitOps_分支: project.gitops.ref,
    Argo_Application: project.argocd.application,
    Rollout: `${project.rollout.namespace}/${project.rollout.name}`
  });

  projectSyncButton.disabled = !sourceProject;
  projectDeleteButton.disabled = !effectiveProject;
}

async function syncSelectedProject() {
  if (!activeProjectId) {
    return;
  }
  try {
    projectNotice.textContent = `正在从 Git 导入/同步 ${activeProjectId}`;
    await api(`/api/projects/${encodeURIComponent(activeProjectId)}/sync`, {
      method: "POST"
    });
    await refreshProjectsRegistry({ silent: true, preserveSelection: true });
    projectNotice.textContent = `项目 ${activeProjectId} 已生效`;
  } catch (error) {
    projectNotice.textContent = `导入/同步失败：${error.message}`;
  }
}

async function deleteSelectedProject() {
  if (!activeProjectId) {
    return;
  }
  const confirmed = window.confirm(`确认仅从系统下线 ${activeProjectId} 吗？Git 中定义不会被修改。`);
  if (!confirmed) {
    return;
  }

  try {
    projectNotice.textContent = `正在从系统下线 ${activeProjectId}`;
    await api(`/api/projects/${encodeURIComponent(activeProjectId)}`, {
      method: "DELETE"
    });
    await refreshProjectsRegistry({ silent: true, preserveSelection: true });
    projectNotice.textContent = `项目 ${activeProjectId} 已从系统下线`;
  } catch (error) {
    projectNotice.textContent = `下线失败：${error.message}`;
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
  renderVersionInventory(versions);
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
  const diagnostics = status.diagnostics || {};
  const diagnosticState = diagnosticSurfaceState(diagnostics);

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
  document.querySelector("#diagnosticDetails").textContent = JSON.stringify(diagnostics, null, 2);
  renderDiagnosticSurface(diagnosticState, diagnostics);

  if (diagnosticState.tone === "error") {
    notice.textContent = `诊断：${diagnosticState.summary}`;
  }
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
  const isErrorStage = ["aborted", "cancelled", "release_failed", "build_failed", "deploy_error"].includes(stage.key);
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

function renderDiagnosticSurface(state, diagnostics) {
  const surface = document.querySelector("#diagnosticSurface");
  const badge = document.querySelector("#diagnosticBadge");
  document.querySelector("#diagnosticTitle").textContent = state.title;
  document.querySelector("#diagnosticSummary").textContent = state.summary;
  badge.textContent = state.badge;
  badge.dataset.tone = state.tone;
  surface.hidden = !state.visible;
  document.querySelector("#diagnosticBody").innerHTML = state.visible
    ? renderDiagnosticsMarkup(diagnostics)
    : "";
}

function renderVersionInventory(versions) {
  versionInventory.innerHTML = versions.length
    ? versions
        .map((version) => {
          const roleText = version.role === "candidate"
            ? "候选版本"
            : version.role === "stable"
              ? "稳定版本"
              : "历史版本";
          const trafficText = version.receivingTraffic ? "接入流量" : "无流量";
          const switchButton = version.canSwitch
            ? `<button class="secondary-action version-switch-button" type="button" data-version-hash="${escapeHtml(version.hash)}">切换</button>`
            : "";
          const deleteButton = version.canDelete
            ? `<button class="secondary-action version-delete-button" type="button" data-version-hash="${escapeHtml(version.hash)}">删除版本</button>`
            : "";

          return `<article class="version-row">
    <div>
      <strong>${escapeHtml(version.hash)}</strong>
      <small>${escapeHtml(roleText)} / ${escapeHtml(trafficText)} / ${escapeHtml(version.replicas.ready)}/${escapeHtml(version.replicas.total)} Ready / 创建于 ${escapeHtml(formatTimestamp(version.createdAt))}</small>
    </div>
    <div class="version-actions">
      ${switchButton}
      ${deleteButton}
    </div>
  </article>`;
        })
        .join("")
    : `<p class="empty-state">暂无版本数据。</p>`;

  for (const button of versionInventory.querySelectorAll(".version-switch-button")) {
    button.addEventListener("click", () => switchVersion(button.getAttribute("data-version-hash")));
  }
  for (const button of versionInventory.querySelectorAll(".version-delete-button")) {
    button.addEventListener("click", () => deleteVersion(button.getAttribute("data-version-hash")));
  }
}

function updateActionStates(stage, status, versions) {
  const releaseButton = document.querySelector("#releaseButton");
  const cancelReleaseButton = document.querySelector("#cancelReleaseButton");
  const abortButton = document.querySelector("#abortButton");
  const releaseRunning = status.releaseTask?.status === "running";
  const hasPromotableVersion = versions.some((version) => version.canPromote);
  const rolloutPhase = status.rollout?.status?.phase || null;
  const rolloutBusy = rolloutPhase === "Paused" || rolloutPhase === "Progressing";

  imageTagInput.disabled = releaseRunning;
  releaseButton.disabled = releaseRunning || hasPromotableVersion || rolloutPhase === "Progressing";
  cancelReleaseButton.disabled = !releaseRunning;
  abortButton.disabled = releaseRunning || !(hasPromotableVersion || rolloutBusy || stage.key === "checking");
}

function actionBody(action) {
  if (action === "release" && imageTagInput.value.trim()) {
    return { imageTag: imageTagInput.value.trim() };
  }
  return {};
}

async function switchVersion(versionHash) {
  if (!activeAppId || !versionHash) {
    return;
  }
  const confirmed = window.confirm(`确认把所有流量切换到版本 ${versionHash} 吗？`);
  if (!confirmed) {
    return;
  }

  try {
    notice.textContent = `正在切换到版本 ${versionHash}`;
    await api(`/api/apps/${encodeURIComponent(activeAppId)}/versions/${encodeURIComponent(versionHash)}/switch`, {
      method: "POST"
    });
    notice.textContent = `已切换到版本 ${versionHash}`;
    await refreshStatus();
  } catch (error) {
    notice.textContent = `切换版本失败：${error.message}`;
  }
}

async function deleteVersion(versionHash) {
  if (!activeAppId || !versionHash) {
    return;
  }
  const confirmed = window.confirm(`确认删除历史版本 ${versionHash} 吗？只有无流量版本允许删除。`);
  if (!confirmed) {
    return;
  }

  try {
    notice.textContent = `正在删除版本 ${versionHash}`;
    await api(`/api/apps/${encodeURIComponent(activeAppId)}/versions/${encodeURIComponent(versionHash)}`, {
      method: "DELETE"
    });
    notice.textContent = `版本 ${versionHash} 已删除`;
    await refreshStatus();
  } catch (error) {
    notice.textContent = `删除版本失败：${error.message}`;
  }
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

function projectToApp(project) {
  return {
    id: project.id,
    name: project.name,
    github: project.github,
    argocd: project.argocd,
    rollout: project.rollout
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    hour12: false
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
