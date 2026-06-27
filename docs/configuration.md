# Configuration

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port, defaults to `8080`. |
| `KADM_APPS_CONFIG` | Preferred path to application config JSON. |
| `ONECD_APPS_CONFIG` | Legacy alias for the application config path. |
| `GITHUB_TOKEN` | Token used to trigger GitHub Actions and read workflow runs. |
| `ARGOCD_BASE_URL` | Argo CD API server URL. |
| `ARGOCD_TOKEN` | Argo CD API token. |
| `KADM_ARGOCD_INSECURE_TLS` | Optional `true` to allow self-signed Argo CD server certificates. |
| `KUBE_API_SERVER` | Optional local Kubernetes API URL. |
| `KUBE_TOKEN` | Optional local Kubernetes bearer token. |

In-cluster deployments use the mounted Kubernetes service account token automatically.

`KADM_CLUSTER_NAME` is the preferred environment variable for the cluster name shown in the UI. `ONECD_CLUSTER_NAME` remains supported as a compatibility alias.

## Application Config

Local development can use `config/apps.example.json`.

Production deployments should mount the registry data from `kadm-app-configs/apps/apps.json` through the `kadm-apps-config` ConfigMap created by `kadmctl configure-delivery`.

Each app needs:

- GitHub owner, repo, workflow, and branch.
- Argo CD Application name.
- Rollout namespace and name.

## Required Cluster Permissions

KADM Release Console needs read and patch access to Argo Rollouts in the `apps` namespace:

- `argoproj.io/rollouts`
- `argoproj.io/rollouts/status`

The default Kustomize base creates a `kadm` ServiceAccount and binds it to a Role in `apps`.
