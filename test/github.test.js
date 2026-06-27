import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowDispatchRequest } from "../src/github.js";

test("builds a GitHub workflow dispatch request", () => {
  const request = buildWorkflowDispatchRequest({
    token: "ghp_test",
    owner: "ccq18",
    repo: "demo-hello",
    workflow: "build-and-publish.yaml",
    ref: "main",
    inputs: { image_tag: "sha-1234567" }
  });

  assert.equal(
    request.url,
    "https://api.github.com/repos/ccq18/demo-hello/actions/workflows/build-and-publish.yaml/dispatches"
  );
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer ghp_test");
  assert.equal(request.headers.Accept, "application/vnd.github+json");
  assert.deepEqual(JSON.parse(request.body), {
    ref: "main",
    inputs: { image_tag: "sha-1234567" }
  });
});
