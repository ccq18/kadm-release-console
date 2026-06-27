import { ArgoCdClient } from "./argocd.js";
import { createApp } from "./app.js";
import { ClusterService } from "./cluster.js";
import { loadAppsConfig, requireEnv } from "./config.js";
import { GitHubClient } from "./github.js";
import { KubernetesRolloutsClient } from "./kubernetes.js";

const env = process.env;
const port = Number.parseInt(env.PORT || "8080", 10);
const apps = loadAppsConfig();

const server = createApp({
  apps,
  github: new GitHubClient({
    token: requireEnv(env, "GITHUB_TOKEN")
  }),
  argocd: new ArgoCdClient({
    baseUrl: requireEnv(env, "ARGOCD_BASE_URL"),
    token: requireEnv(env, "ARGOCD_TOKEN")
  }),
  rollouts: KubernetesRolloutsClient.fromEnv(env),
  cluster: ClusterService.fromEnv(env)
});

server.listen(port, "0.0.0.0", () => {
  console.log(`kadm-release-console listening on port ${port}`);
});
