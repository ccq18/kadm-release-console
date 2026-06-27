import { joinUrl, jsonHeaders, sendJsonRequest } from "./request.js";

const GITHUB_API_BASE = "https://api.github.com";

export function buildWorkflowDispatchRequest({ token, owner, repo, workflow, ref, inputs = {} }) {
  return {
    url: joinUrl(
      GITHUB_API_BASE,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`
    ),
    method: "POST",
    headers: jsonHeaders(token, {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }),
    body: JSON.stringify({ ref, inputs })
  };
}

export function buildWorkflowRunsRequest({ token, owner, repo, workflow, branch, limit = 10 }) {
  const params = new URLSearchParams({
    per_page: String(limit)
  });
  if (branch) {
    params.set("branch", branch);
  }

  return {
    url: joinUrl(
      GITHUB_API_BASE,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs?${params.toString()}`
    ),
    method: "GET",
    headers: jsonHeaders(token, {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    })
  };
}

export class GitHubClient {
  constructor({ token, fetchImpl }) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async dispatchWorkflow(app, { imageTag } = {}) {
    const inputs = {};
    if (imageTag) {
      inputs.image_tag = imageTag;
    }

    const request = buildWorkflowDispatchRequest({
      token: this.token,
      owner: app.github.owner,
      repo: app.github.repo,
      workflow: app.github.workflow,
      ref: app.github.ref,
      inputs
    });

    await sendJsonRequest(request, this.fetchImpl);
    return { dispatched: true, ref: app.github.ref, inputs };
  }

  async listWorkflowRuns(app) {
    const request = buildWorkflowRunsRequest({
      token: this.token,
      owner: app.github.owner,
      repo: app.github.repo,
      workflow: app.github.workflow,
      branch: app.github.ref
    });

    const data = await sendJsonRequest(request, this.fetchImpl);
    return data.workflow_runs || [];
  }
}
