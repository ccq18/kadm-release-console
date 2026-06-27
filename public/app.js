import {
  deriveReleaseStage,
  localizeActionLabel,
  localizeStatusText,
  nextRefreshDelayMs,
  releaseSteps
} from "./release-state.js";

let apps = [];
let projects = [];
let activeAppId = null;
let activeProjectId = null;
let activeView = "release";
let joinRole = "worker";
let refreshTimer = null;
let isRefreshing = false;
let projectMode = "create";

const appList = document.querySelector("#appList");
const appTitle = document.querySelector("#appTitle");
const notice = document.querySelector("#notice");
const clusterNotice = document.querySelector("#clusterNotice");
const projectNotice = document.querySelector("#projectNotice");
const imageTagInput = document.querySelector("#imageTagInput");
const versionSelect = document.querySelector("#versionSelect");
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
const projectCount = document.querySelector("#projectCount");
const projectForm = document.querySelector("#projectForm");
const projectFormTitle = document.querySelector("#projectFormTitle");
const projectDeleteButton = document.querySelector("#projectDeleteButton");
const projectIdInput = document.querySelector("#projectIdInput");
const projectNameInput = document.querySelector("#projectNameInput");
const projectGithubOwnerInput = document.querySelector("#projectGithubOwnerInput");
const projectGithubRepoInput = document.querySelector("#projectGithubRepoInput");
const projectGithubWorkflowInput = document.querySelector("#projectGithubWorkflowInput");
const projectGithubRefInput = document.querySelector("#projectGithubRefInput");
const projectGitopsOwnerInput = document.querySelector("#projectGitopsOwnerInput");
const projectGitopsRepoInput = document.querySelector("#projectGitopsRepoInput");
const projectGitopsPathInput = document.querySelector("#projectGitopsPathInput");
const projectGitopsImageInput = document.querySelector("#projectGitopsImageInput");
const projectGitopsRefInput = document.querySelector("#projectGitopsRefInput");
const projectArgocdApplicationInput = document.querySelector("#projectArgocdApplicationInput");
const projectRolloutNamespaceInput = document.querySelector("#projectRolloutNamespaceInput");
const projectRolloutNameInput = document.querySelector("#projectRolloutNameInput");

document.querySelector("#refreshButton").addEventListener("click", () => refreshStatus());
document.querySelector("#clusterRefreshButton").addEventListener("click", () => refreshCluster());
document.querySelector("#releaseButton").addEventListener("click", () => runAction("release"));
document.querySelector("#promoteButton").addEventListener("click", () => runAction("promote"));
document.querySelector("#cancelReleaseButton").addEventListener("click", () => runAction("release/cancel"));
document.querySelector("#abortButton").addEventListener("click", () => runAction("rollout/abort"));
clusterNavButton.addEventListener("click", () => showClusterView());
projectNavButton.addEventListener("click", () => showProjectView());
workerRoleButton.addEventListener("click", () => selectJoinRole("worker"));
masterRoleButton.addEventListener("click", () => selectJoinRole("master"));
document.querySelector("#generateJoinButton").addEventListener("click", () => generateJoinScript());
copyJoinButton.addEventListener("click", () => copyJoinScript());
document.querySelector("#projectRefreshButton").addEventListener("click", () => refreshProjectsRegistry());
document.querySelector("#projectNewButton").addEventListener("click", () => beginCreateProject());
projectDeleteButton.addEventListener("click", () => deleteProject());
projectForm.addEventListener("submit", (event) => saveProject(event));
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
    const data = await api("/api/projects");
    projects = data.projects || [];
    apps = projects.map(projectToApp);

    if (!preserveSelection || !projects.some((project) => project.id === activeProjectId)) {
      activeProjectId = projects[0]?.id || null;
    }
    if (!apps.some((app) => app.id === activeAppId)) {
      activeAppId = apps[0]?.id || null;
    }

    renderAppList();
    renderProjectList();

    if (projectMode === "create" && activeProjectId === null) {
      renderProjectForm(null);
    } else {
      renderProjectForm(projects.find((project) => project.id === activeProjectId) || null);
    }

    if (!silent) {
      projectNotice.textContent = "项目已刷新";
    }
  } catch (error) {
    projectNotice.textContent = `项目刷新失败：${error.message}`;
  }
}

function renderProjectList() {
  projectCount.textContent = String(projects.length);
  projectList.innerHTML = projects.length
    ? projects
        .map(
          (project) => `<button class="project-row" type="button" data-project-id="${escapeHtml(project.id)}" aria-current="${project.id === activeProjectId ? "true" : "false"}">
    <strong>${escapeHtml(project.name)}</strong>
    <small>${escapeHtml(project.id)} / ${escapeHtml(project.argocd.application)} / ${escapeHtml(project.gitops.path)}</small>
  </button>`
        )
        .join("")
    : `<p class="empty-state">当前没有生效中的项目。</p>`;

  for (const button of projectList.querySelectorAll("[data-project-id]")) {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-project-id");
      activeProjectId = id;
      projectMode = "edit";
      renderProjectList();
      renderProjectForm(projects.find((project) => project.id === id) || null);
    });
  }
}

function beginCreateProject() {
  activeProjectId = null;
  projectMode = "create";
  renderProjectList();
  renderProjectForm(null);
  projectNotice.textContent = "填写表单后生效保存。";
}

function renderProjectForm(project) {
  if (!project) {
    projectFormTitle.textContent = "新建项目";
    projectDeleteButton.disabled = true;
    projectIdInput.disabled = false;
    projectArgocdApplicationInput.disabled = false;
    projectIdInput.value = "";
    projectNameInput.value = "";
    projectGithubOwnerInput.value = "";
    projectGithubRepoInput.value = "";
    projectGithubWorkflowInput.value = "build-and-publish.yaml";
    projectGithubRefInput.value = "main";
    projectGitopsOwnerInput.value = "";
    projectGitopsRepoInput.value = "kadm-app-configs";
    projectGitopsPathInput.value = "";
    projectGitopsImageInput.value = "";
    projectGitopsRefInput.value = "main";
    projectArgocdApplicationInput.value = "";
    projectRolloutNamespaceInput.value = "apps";
    projectRolloutNameInput.value = "";
    return;
  }

  projectFormTitle.textContent = `编辑项目 / ${project.id}`;
  projectDeleteButton.disabled = false;
  projectIdInput.disabled = true;
  projectArgocdApplicationInput.disabled = true;
  projectIdInput.value = project.id;
  projectNameInput.value = project.name;
  projectGithubOwnerInput.value = project.github.owner;
  projectGithubRepoInput.value = project.github.repo;
  projectGithubWorkflowInput.value = project.github.workflow;
  projectGithubRefInput.value = project.github.ref;
  projectGitopsOwnerInput.value = project.gitops.owner;
  projectGitopsRepoInput.value = project.gitops.repo;
  projectGitopsPathInput.value = project.gitops.path;
  projectGitopsImageInput.value = project.gitops.image;
  projectGitopsRefInput.value = project.gitops.ref;
  projectArgocdApplicationInput.value = project.argocd.application;
  projectRolloutNamespaceInput.value = project.rollout.namespace;
  projectRolloutNameInput.value = project.rollout.name;
}

async function saveProject(event) {
  event.preventDefault();
  const payload = collectProjectForm();

  try {
    projectNotice.textContent = projectMode === "create" ? "正在新增项目" : "正在更新项目";
    const path = projectMode === "create" ? "/api/projects" : `/api/projects/${encodeURIComponent(activeProjectId)}`;
    const method = projectMode === "create" ? "POST" : "PATCH";
    const data = await api(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    activeProjectId = data.project.id;
    projectMode = "edit";
    await refreshProjectsRegistry({ silent: true, preserveSelection: true });
    renderProjectList();
    renderProjectForm(projects.find((project) => project.id === activeProjectId) || null);
    projectNotice.textContent = "项目生效完成";
  } catch (error) {
    projectNotice.textContent = `项目生效失败：${error.message}`;
  }
}

async function deleteProject() {
  if (!activeProjectId) {
    return;
  }
  const confirmed = window.confirm(`确认下线并删除项目 ${activeProjectId} 吗？`);
  if (!confirmed) {
    return;
  }

  try {
    projectNotice.textContent = `正在删除项目 ${activeProjectId}`;
    await api(`/api/projects/${encodeURIComponent(activeProjectId)}`, {
      method: "DELETE"
    });
    activeProjectId = null;
    projectMode = "create";
    await refreshProjectsRegistry({ silent: true, preserveSelection: false });
    renderProjectForm(null);
    projectNotice.textContent = "项目已从生效层删除";
  } catch (error) {
    projectNotice.textContent = `删除失败：${error.message}`;
  }
}

function collectProjectForm() {
  return {
    id: projectIdInput.value.trim(),
    name: projectNameInput.value.trim(),
    github: {
      owner: projectGithubOwnerInput.value.trim(),
      repo: projectGithubRepoInput.value.trim(),
      workflow: projectGithubWorkflowInput.value.trim(),
      ref: projectGithubRefInput.value.trim()
    },
    gitops: {
      owner: projectGitopsOwnerInput.value.trim(),
      repo: projectGitopsRepoInput.value.trim(),
      path: projectGitopsPathInput.value.trim(),
      image: projectGitopsImageInput.value.trim(),
      ref: projectGitopsRefInput.value.trim()
    },
    argocd: {
      application: projectArgocdApplicationInput.value.trim()
    },
    rollout: {
      namespace: projectRolloutNamespaceInput.value.trim(),
      name: projectRolloutNameInput.value.trim()
    }
  };
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
