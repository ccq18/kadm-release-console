import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkflowDispatchRequest,
  buildGitHubContentRequest,
  buildGitHubContentUpdateRequest,
  updateKustomizeImageTag
} from "../src/github.js";

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

test("builds a GitHub content request", () => {
  const request = buildGitHubContentRequest({
    token: "ghp_test",
    owner: "ccq18",
    repo: "kadm-app-configs",
    path: "apps/demo-hello/overlays/prod/kustomization.yaml",
    ref: "main"
  });

  assert.equal(
    request.url,
    "https://api.github.com/repos/ccq18/kadm-app-configs/contents/apps%2Fdemo-hello%2Foverlays%2Fprod%2Fkustomization.yaml?ref=main"
  );
  assert.equal(request.method, "GET");
});

test("builds a GitHub content update request", () => {
  const request = buildGitHubContentUpdateRequest({
    token: "ghp_test",
    owner: "ccq18",
    repo: "kadm-app-configs",
    path: "apps/demo-hello/overlays/prod/kustomization.yaml",
    branch: "main",
    sha: "abc123",
    message: "chore: release demo-hello sha-1234567",
    content: "hello"
  });

  assert.equal(
    request.url,
    "https://api.github.com/repos/ccq18/kadm-app-configs/contents/apps%2Fdemo-hello%2Foverlays%2Fprod%2Fkustomization.yaml"
  );
  assert.equal(request.method, "PUT");
  assert.deepEqual(JSON.parse(request.body), {
    message: "chore: release demo-hello sha-1234567",
    content: Buffer.from("hello").toString("base64"),
    sha: "abc123",
    branch: "main"
  });
});

test("updates a kustomize image tag in-place", () => {
  const updated = updateKustomizeImageTag(
    `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
images:
- name: ghcr.io/ccq18/demo-hello
  newName: ghcr.io/ccq18/demo-hello
  newTag: sha-old
`,
    "sha-new"
  );

  assert.match(updated, /newTag: sha-new/);
  assert.doesNotMatch(updated, /newTag: sha-old/);
});
