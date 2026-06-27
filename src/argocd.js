import { joinUrl, jsonHeaders, sendJsonRequest } from "./request.js";

export function buildApplicationRequest({ baseUrl, token, application }) {
  return {
    url: joinUrl(baseUrl, `/api/v1/applications/${encodeURIComponent(application)}`),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildSyncRequest({ baseUrl, token, application, revision }) {
  const body = {
    prune: true,
    dryRun: false
  };

  if (revision) {
    body.revision = revision;
  }

  return {
    url: joinUrl(baseUrl, `/api/v1/applications/${encodeURIComponent(application)}/sync`),
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(body)
  };
}

export class ArgoCdClient {
  constructor({ baseUrl, token, fetchImpl }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async getApplication(app) {
    return sendJsonRequest(
      buildApplicationRequest({
        baseUrl: this.baseUrl,
        token: this.token,
        application: app.argocd.application
      }),
      this.fetchImpl
    );
  }

  async syncApplication(app) {
    return sendJsonRequest(
      buildSyncRequest({
        baseUrl: this.baseUrl,
        token: this.token,
        application: app.argocd.application,
        revision: app.github.ref
      }),
      this.fetchImpl
    );
  }
}
