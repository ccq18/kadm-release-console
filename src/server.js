import { ArgoCdClient } from "./argocd.js";
import { createApp } from "./app.js";
import { ClusterService } from "./cluster.js";
import { loadAppsConfig, requireEnv } from "./config.js";
import { GitHubClient } from "./github.js";
import { KubernetesRolloutsClient } from "./kubernetes.js";
import { EffectiveProjectRegistryService, KubernetesSourceProjectRegistry } from "./projects.js";

const env = process.env;
const port = Number.parseInt(env.PORT || "8080", 10);
const apps = loadAppsConfig();
const github = new GitHubClient({
  token: requireEnv(env, "GITHUB_TOKEN")
});
const appRegistry = EffectiveProjectRegistryService.fromEnv(env, { fallbackApps: apps });
const sourceProjectRegistry = KubernetesSourceProjectRegistry.fromEnv(env, { fallbackApps: apps });

const server = createApp({
  apps,
  appRegistry,
  sourceProjectRegistry,
  github,
  argocd: new ArgoCdClient({
    baseUrl: requireEnv(env, "ARGOCD_BASE_URL"),
    token: requireEnv(env, "ARGOCD_TOKEN"),
    insecureTLS: env.KADM_ARGOCD_INSECURE_TLS === "true" || env.ONECD_ARGOCD_INSECURE_TLS === "true"
  }),
  rollouts: KubernetesRolloutsClient.fromEnv(env),
  cluster: ClusterService.fromEnv(env)
});

server.listen(port, "0.0.0.0", () => {
  console.log(`kadm-release-console listening on port ${port}`);
});
