# Configuration

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port, defaults to `8080`. |
| `ONECD_APPS_CONFIG` | Path to application config JSON. |
| `GITHUB_TOKEN` | Token used to trigger GitHub Actions and read workflow runs. |
| `ARGOCD_BASE_URL` | Argo CD API server URL. |
| `ARGOCD_TOKEN` | Argo CD API token. |
| `KUBE_API_SERVER` | Optional local Kubernetes API URL. |
| `KUBE_TOKEN` | Optional local Kubernetes bearer token. |

In-cluster deployments use the mounted Kubernetes service account token automatically.

## Application Config

See `config/apps.example.json`.

Each app needs:

- GitHub owner, repo, workflow, and branch.
- Argo CD Application name.
- Rollout namespace and name.

## Required Cluster Permissions

KADM Release Console needs read and patch access to Argo Rollouts in the `apps` namespace:

- `argoproj.io/rollouts`
- `argoproj.io/rollouts/status`

The default Kustomize base creates a `onecd` ServiceAccount and binds it to a Role in `apps`.
