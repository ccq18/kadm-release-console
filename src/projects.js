import fs from "node:fs";
import { normalizeAppsConfig } from "./config.js";
import { joinUrl, jsonHeaders, sendJsonRequest } from "./request.js";

const SERVICE_ACCOUNT_TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const REGISTRY_NAMESPACE = "kadm";
const REGISTRY_CONFIGMAP = "kadm-apps-config";
const SOURCE_REGISTRY_CONFIGMAP = "kadm-source-apps-config";
const REGISTRY_KEY = "apps.json";
const ARGOCD_NAMESPACE = "argocd";
const APPLICATION_MANAGER_LABEL = "kadm.ai/managed-by";
const APPLICATION_MANAGER_VALUE = "effective-registry";

export function createStaticAppRegistry(apps = []) {
  return {
    async listApps() {
      return apps;
    },
    async getApp(id) {
      return findProject(apps, id);
    },
    async createApp() {
      throw unsupportedRegistryMutation();
    },
    async updateApp() {
      throw unsupportedRegistryMutation();
    },
    async deleteApp() {
      throw unsupportedRegistryMutation();
    }
  };
}

export function createStaticSourceProjectRegistry(apps = []) {
  return {
    async listApps() {
      return apps;
    },
    async getApp(id) {
      return findProject(apps, id);
    }
  };
}

export function publicProject(app) {
  return {
    id: app.id,
    name: app.name,
    github: { ...app.github },
    gitops: { ...app.gitops },
    argocd: { ...app.argocd },
    rollout: { ...app.rollout }
  };
}

export function buildRegistryApplication(app) {
  return {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: {
      name: app.argocd.application,
      namespace: ARGOCD_NAMESPACE,
      labels: {
        [APPLICATION_MANAGER_LABEL]: APPLICATION_MANAGER_VALUE
      }
    },
    spec: {
      project: "default",
      source: {
        repoURL: `https://github.com/${app.gitops.owner}/${app.gitops.repo}.git`,
        targetRevision: app.gitops.ref,
        path: app.gitops.path
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: app.rollout.namespace
      },
      syncPolicy: {
        automated: {
          prune: true,
          selfHeal: true
        },
        syncOptions: ["CreateNamespace=true"]
      }
    }
  };
}

export class EffectiveProjectRegistryService {
  constructor({ kubernetes, fallbackApps = [] }) {
    this.kubernetes = kubernetes;
    this.fallbackApps = fallbackApps;
  }

  static fromEnv(env = process.env, { fallbackApps = [] } = {}) {
    return new EffectiveProjectRegistryService({
      kubernetes: KubernetesProjectRegistryClient.fromEnv(env),
      fallbackApps
    });
  }

  async listApps() {
    return this.loadEffectiveApps();
  }

  async getApp(id) {
    return findProject(await this.loadEffectiveApps(), id);
  }

  async createApp(input) {
    const current = await this.loadEffectiveApps();
    ensureProjectDoesNotExist(current, input.id, input.argocd?.application);
    const next = normalizeAppsConfig([...current, input]);
    const created = findProject(next, input.id);
    await this.kubernetes.writeRegistryApps(next);
    await this.kubernetes.upsertApplication(created);
    return created;
  }

  async syncApp(sourceApp) {
    const current = await this.loadEffectiveApps();
    const exists = current.some((app) => app.id === sourceApp.id);
    if (exists) {
      return this.updateApp(sourceApp.id, sourceApp);
    }
    return this.createApp(sourceApp);
  }

  async updateApp(id, patch) {
    const current = await this.loadEffectiveApps();
    const existing = findProject(current, id);
    rejectProjectRename(existing, patch);

    const updated = normalizeAppsConfig(
      current.map((app) => (app.id === id ? mergeProjectPatch(app, patch) : app))
    );
    const project = findProject(updated, id);
    await this.kubernetes.writeRegistryApps(updated);
    await this.kubernetes.upsertApplication(project);
    return project;
  }

  async deleteApp(id) {
    const current = await this.loadEffectiveApps();
    const existing = findProject(current, id);
    const next = current.filter((app) => app.id !== id);
    await this.kubernetes.writeRegistryApps(next);
    await this.kubernetes.deleteApplication(existing.argocd.application);
    return { deleted: true, id };
  }

  async loadEffectiveApps() {
    try {
      const apps = await this.kubernetes.readRegistryApps();
      return normalizeAppsConfig(apps);
    } catch (error) {
      if (error.status === 404) {
        return this.fallbackApps;
      }
      throw error;
    }
  }
}

export class KubernetesSourceProjectRegistry {
  constructor({ kubernetes, fallbackApps = [] }) {
    this.kubernetes = kubernetes;
    this.fallbackApps = fallbackApps;
  }

  static fromEnv(env = process.env, { fallbackApps = [] } = {}) {
    return new KubernetesSourceProjectRegistry({
      kubernetes: KubernetesProjectRegistryClient.fromEnv(env),
      fallbackApps
    });
  }

  async listApps() {
    return this.loadSourceApps();
  }

  async getApp(id) {
    return findProject(await this.loadSourceApps(), id);
  }

  async loadSourceApps() {
    try {
      return normalizeAppsConfig(await this.kubernetes.readSourceApps());
    } catch (error) {
      if (error.status === 404) {
        return this.fallbackApps;
      }
      throw error;
    }
  }
}

export class KubernetesProjectRegistryClient {
  constructor({ apiServer, token, fetchImpl }) {
    this.apiServer = apiServer;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env = process.env) {
    const apiServer =
      env.KUBE_API_SERVER ||
      `https://${env.KUBERNETES_SERVICE_HOST || "kubernetes.default.svc"}:${env.KUBERNETES_SERVICE_PORT_HTTPS || "443"}`;
    const token =
      env.KUBE_TOKEN ||
      (fs.existsSync(SERVICE_ACCOUNT_TOKEN)
        ? fs.readFileSync(SERVICE_ACCOUNT_TOKEN, "utf8").trim()
        : "");

    return new KubernetesProjectRegistryClient({ apiServer, token });
  }

  async readConfigMapApps(name) {
    const configMap = await sendJsonRequest(
      buildConfigMapGetRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: REGISTRY_NAMESPACE,
        name
      }),
      this.fetchImpl
    );
    return JSON.parse(configMap.data?.[REGISTRY_KEY] || "[]");
  }

  async readRegistryApps() {
    return this.readConfigMapApps(REGISTRY_CONFIGMAP);
  }

  async readSourceApps() {
    return this.readConfigMapApps(SOURCE_REGISTRY_CONFIGMAP);
  }

  async writeConfigMapApps(name, apps) {
    let existing = null;
    try {
      existing = await sendJsonRequest(
        buildConfigMapGetRequest({
          apiServer: this.apiServer,
          token: this.token,
          namespace: REGISTRY_NAMESPACE,
          name
        }),
        this.fetchImpl
      );
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    const resource = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name,
        namespace: REGISTRY_NAMESPACE
      },
      data: {
        [REGISTRY_KEY]: JSON.stringify(apps, null, 2)
      }
    };

    if (existing) {
      resource.metadata.resourceVersion = existing.metadata?.resourceVersion;
      return sendJsonRequest(
        buildConfigMapReplaceRequest({
          apiServer: this.apiServer,
          token: this.token,
          namespace: REGISTRY_NAMESPACE,
          name,
          body: resource
        }),
        this.fetchImpl
      );
    }

    return sendJsonRequest(
      buildConfigMapCreateRequest({
        apiServer: this.apiServer,
        token: this.token,
        namespace: REGISTRY_NAMESPACE,
        body: resource
      }),
      this.fetchImpl
    );
  }

  async writeRegistryApps(apps) {
    return this.writeConfigMapApps(REGISTRY_CONFIGMAP, apps);
  }

  async writeSourceApps(apps) {
    return this.writeConfigMapApps(SOURCE_REGISTRY_CONFIGMAP, apps);
  }

  async upsertApplication(app) {
    const resource = buildRegistryApplication(app);
    let existing = null;
    try {
      existing = await sendJsonRequest(
        buildApplicationGetRequest({
          apiServer: this.apiServer,
          token: this.token,
          name: app.argocd.application
        }),
        this.fetchImpl
      );
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    if (existing) {
      resource.metadata.resourceVersion = existing.metadata?.resourceVersion;
      return sendJsonRequest(
        buildApplicationReplaceRequest({
          apiServer: this.apiServer,
          token: this.token,
          name: app.argocd.application,
          body: resource
        }),
        this.fetchImpl
      );
    }

    return sendJsonRequest(
      buildApplicationCreateRequest({
        apiServer: this.apiServer,
        token: this.token,
        body: resource
      }),
      this.fetchImpl
    );
  }

  async deleteApplication(name) {
    try {
      await sendJsonRequest(
        buildApplicationFinalizerPatchRequest({
          apiServer: this.apiServer,
          token: this.token,
          name,
          finalizers: ["resources-finalizer.argocd.argoproj.io"]
        }),
        this.fetchImpl
      );
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    try {
      return await sendJsonRequest(
        buildApplicationDeleteRequest({
          apiServer: this.apiServer,
          token: this.token,
          name
        }),
        this.fetchImpl
      );
    } catch (error) {
      if (error.status === 404) {
        return { deleted: true, name, missing: true };
      }
      throw error;
    }
  }
}

export function buildConfigMapGetRequest({ apiServer, token, namespace, name }) {
  return {
    url: joinUrl(apiServer, `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildConfigMapCreateRequest({ apiServer, token, namespace, body }) {
  return {
    url: joinUrl(apiServer, `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps`),
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(body)
  };
}

export function buildConfigMapReplaceRequest({ apiServer, token, namespace, name, body }) {
  return {
    url: joinUrl(apiServer, `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`),
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify(body)
  };
}

export function buildApplicationGetRequest({ apiServer, token, name }) {
  return {
    url: joinUrl(
      apiServer,
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(ARGOCD_NAMESPACE)}/applications/${encodeURIComponent(name)}`
    ),
    method: "GET",
    headers: jsonHeaders(token)
  };
}

export function buildApplicationCreateRequest({ apiServer, token, body }) {
  return {
    url: joinUrl(apiServer, `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(ARGOCD_NAMESPACE)}/applications`),
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(body)
  };
}

export function buildApplicationReplaceRequest({ apiServer, token, name, body }) {
  return {
    url: joinUrl(
      apiServer,
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(ARGOCD_NAMESPACE)}/applications/${encodeURIComponent(name)}`
    ),
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify(body)
  };
}

export function buildApplicationFinalizerPatchRequest({ apiServer, token, name, finalizers }) {
  return {
    url: joinUrl(
      apiServer,
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(ARGOCD_NAMESPACE)}/applications/${encodeURIComponent(name)}`
    ),
    method: "PATCH",
    headers: jsonHeaders(token, {
      "Content-Type": "application/merge-patch+json"
    }),
    body: JSON.stringify({
      metadata: {
        finalizers
      }
    })
  };
}

export function buildApplicationDeleteRequest({ apiServer, token, name }) {
  return {
    url: joinUrl(
      apiServer,
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(ARGOCD_NAMESPACE)}/applications/${encodeURIComponent(name)}`
    ),
    method: "DELETE",
    headers: jsonHeaders(token)
  };
}

function findProject(apps, id) {
  const app = apps.find((candidate) => candidate.id === id);
  if (!app) {
    const error = new Error(`Unknown app: ${id}`);
    error.status = 404;
    throw error;
  }
  return app;
}

function ensureProjectDoesNotExist(apps, id, applicationName) {
  if (apps.some((app) => app.id === id)) {
    const error = new Error(`Project already exists: ${id}`);
    error.status = 409;
    throw error;
  }
  if (applicationName && apps.some((app) => app.argocd.application === applicationName)) {
    const error = new Error(`Argo CD application already exists: ${applicationName}`);
    error.status = 409;
    throw error;
  }
}

function rejectProjectRename(existing, patch) {
  if (patch.id && patch.id !== existing.id) {
    const error = new Error("Project id cannot be changed. Create a new project and delete the old one instead.");
    error.status = 409;
    throw error;
  }
  if (patch.argocd?.application && patch.argocd.application !== existing.argocd.application) {
    const error = new Error("Argo CD application name cannot be changed in-place. Create a new project and delete the old one instead.");
    error.status = 409;
    throw error;
  }
}

function mergeProjectPatch(existing, patch) {
  return {
    ...existing,
    ...patch,
    github: {
      ...existing.github,
      ...(patch.github || {})
    },
    gitops: {
      ...existing.gitops,
      ...(patch.gitops || {})
    },
    argocd: {
      ...existing.argocd,
      ...(patch.argocd || {})
    },
    rollout: {
      ...existing.rollout,
      ...(patch.rollout || {})
    }
  };
}

function unsupportedRegistryMutation() {
  const error = new Error("Project registry mutations are not configured.");
  error.status = 503;
  return error;
}
