import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticSurfaceState, renderDiagnosticsMarkup } from "../public/diagnostics-view.js";

test("builds an actionable diagnostics surface for blocking rollout failures", () => {
  const diagnostics = {
    summary: { severity: "error", message: 'Error: secret "hellospring-db" not found' },
    pods: [
      {
        name: "hellospring-6f9dd7954b-86qz5",
        phase: "Pending",
        ready: false,
        restartCount: 0,
        nodeName: "worker-1",
        image: "ghcr.io/ccq18/demo-hello-spring:sha-f7775a0",
        reason: "CreateContainerConfigError",
        message: 'secret "hellospring-db" not found',
        startedAt: "2026-06-28T04:21:55Z"
      }
    ],
    events: [
      {
        type: "Warning",
        reason: "Failed",
        message: 'Error: secret "hellospring-db" not found',
        involvedKind: "Pod",
        involvedName: "hellospring-6f9dd7954b-86qz5",
        lastTimestamp: "2026-06-28T04:21:55Z"
      }
    ],
    logs: []
  };

  const surface = diagnosticSurfaceState(diagnostics);
  const markup = renderDiagnosticsMarkup(diagnostics);

  assert.equal(surface.tone, "error");
  assert.equal(surface.title, "发布异常");
  assert.match(surface.summary, /hellospring-db/);
  assert.match(markup, /CreateContainerConfigError/);
  assert.match(markup, /当前没有可读取的容器日志/);
  assert.match(markup, /hellospring-6f9dd7954b-86qz5/);
});
