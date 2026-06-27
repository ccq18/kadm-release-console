import { joinUrl, jsonHeaders, sendJsonRequest } from "./request.js";

export function buildApplicationRequest({ baseUrl, token, application, insecureTLS = false }) {
  return {
    url: joinUrl(baseUrl, `/api/v1/applications/${encodeURIComponent(application)}`),
    method: "GET",
    headers: jsonHeaders(token),
    insecureTLS
  };
}

export function buildSyncRequest({ baseUrl, token, application, revision, insecureTLS = false }) {
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
    body: JSON.stringify(body),
    insecureTLS
  };
}

export class ArgoCdClient {
  constructor({ baseUrl, token, fetchImpl, insecureTLS = false }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.insecureTLS = insecureTLS;
  }

  async getApplication(app) {
    return sendJsonRequest(
      buildApplicationRequest({
        baseUrl: this.baseUrl,
        token: this.token,
        application: app.argocd.application,
        insecureTLS: this.insecureTLS
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
        revision: app.github.ref,
        insecureTLS: this.insecureTLS
      }),
      this.fetchImpl
    );
  }
}
