export function diagnosticSurfaceState(diagnostics = {}) {
  const summary = diagnostics?.summary || null;
  if (summary?.severity === "error") {
    return {
      visible: true,
      tone: "error",
      badge: "阻塞中",
      title: "发布异常",
      summary: summary.message || "检测到阻塞当前发布的问题。"
    };
  }

  if (summary?.severity === "warn") {
    return {
      visible: true,
      tone: "warn",
      badge: "需关注",
      title: "检查异常",
      summary: summary.message || "检测到需要关注的运行状态。"
    };
  }

  if (hasActionableDiagnostics(diagnostics)) {
    return {
      visible: true,
      tone: "neutral",
      badge: "已采集",
      title: "运行诊断",
      summary: "系统已采集到运行时信息，可继续检查 Pod、事件和日志。"
    };
  }

  return {
    visible: false,
    tone: "neutral",
    badge: "正常",
    title: "运行正常",
    summary: "当前没有需要展开的运行诊断。"
  };
}

export function renderDiagnosticsMarkup(diagnostics = {}) {
  return [
    renderSection("Pod 状态", renderPods(diagnostics.pods || [])),
    renderSection("最近事件", renderEvents(diagnostics.events || [])),
    renderSection("容器日志", renderLogs(diagnostics.logs || [], diagnostics))
  ].join("");
}

function hasActionableDiagnostics(diagnostics) {
  const pods = Array.isArray(diagnostics?.pods) ? diagnostics.pods : [];
  const events = Array.isArray(diagnostics?.events) ? diagnostics.events : [];
  const logs = Array.isArray(diagnostics?.logs) ? diagnostics.logs : [];

  return (
    pods.some((pod) => pod.reason || pod.phase !== "Running" || pod.ready === false) ||
    events.some((event) => event.type === "Warning") ||
    logs.some((entry) => entry.error)
  );
}

function renderSection(title, body) {
  return `<article class="diagnostic-panel">
    <h4>${escapeHtml(title)}</h4>
    ${body}
  </article>`;
}

function renderPods(pods) {
  if (!pods.length) {
    return `<p class="diagnostic-empty">当前没有采集到 Pod 状态。</p>`;
  }

  return `<ul class="diagnostic-list">
    ${pods
      .slice(0, 4)
      .map(
        (pod) => `<li class="diagnostic-item">
      <strong>${escapeHtml(pod.name || "unknown")}</strong>
      <span>${escapeHtml(formatPodState(pod))}</span>
      <p>${escapeHtml(pod.message || pod.image || "没有额外说明。")}</p>
    </li>`
      )
      .join("")}
  </ul>`;
}

function renderEvents(events) {
  if (!events.length) {
    return `<p class="diagnostic-empty">当前没有相关事件。</p>`;
  }

  return `<ul class="diagnostic-list">
    ${events
      .slice(0, 6)
      .map(
        (event) => `<li class="diagnostic-item">
      <strong>${escapeHtml(`${event.type || "Normal"} / ${event.reason || "Unknown"}`)}</strong>
      <span>${escapeHtml(formatEventMeta(event))}</span>
      <p>${escapeHtml(event.message || "没有事件消息。")}</p>
    </li>`
      )
      .join("")}
  </ul>`;
}

function renderLogs(logs, diagnostics) {
  if (!logs.length) {
    const blocked = Array.isArray(diagnostics?.pods)
      ? diagnostics.pods.some((pod) => pod.reason || pod.phase !== "Running")
      : false;
    return `<p class="diagnostic-empty">${
      blocked
        ? "当前没有可读取的容器日志。Pod 还没有进入 Running，可先根据事件和配置错误排查。"
        : "当前没有采集到容器日志。"
    }</p>`;
  }

  return `<div class="diagnostic-log-list">
    ${logs
      .slice(0, 2)
      .map((entry) => {
        const title = `${entry.pod || "unknown"}${entry.container ? ` / ${entry.container}` : ""}`;
        const body = entry.error || entry.text || "日志为空。";
        return `<section class="diagnostic-log-entry">
  <strong>${escapeHtml(title)}</strong>
  <pre>${escapeHtml(body)}</pre>
</section>`;
      })
      .join("")}
  </div>`;
}

function formatPodState(pod) {
  const parts = [pod.phase || "Unknown"];
  if (pod.reason) {
    parts.push(pod.reason);
  }
  if (pod.nodeName) {
    parts.push(pod.nodeName);
  }
  return parts.join(" / ");
}

function formatEventMeta(event) {
  const parts = [];
  if (event.lastTimestamp) {
    parts.push(formatTimestamp(event.lastTimestamp));
  }
  if (event.involvedKind || event.involvedName) {
    parts.push([event.involvedKind || "Object", event.involvedName || "unknown"].join(" / "));
  }
  return parts.join(" / ") || "事件来源未知";
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "时间未知";
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
