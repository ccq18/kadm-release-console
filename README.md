# KADM Release Console

KADM Release Console is a compact release console for the two demo applications in this k3s environment:

- `demo-hello`
- `demo-hello-spring`

It coordinates three systems:

- GitHub Actions for image builds.
- Argo CD for GitOps sync.
- Argo Rollouts through the Kubernetes CRD API for rollout status and actions.

KADM Release Console is intentionally deployed as a ClusterIP-only internal service. Do not expose it with a public Ingress until authentication, HTTPS, and an access policy are in place.

## Local Development

```bash
npm ci
cp .env.example .env
cp config/apps.example.json config/apps.json
npm run dev
```

Required environment variables are documented in `docs/configuration.md`.

## Access

Use port-forwarding from an authenticated kubectl session:

```bash
kubectl -n onecd port-forward svc/onecd 18080:80
```

Then open:

```text
http://127.0.0.1:18080
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/apps` | List configured apps. |
| `GET` | `/api/apps/:id/status` | Read GitHub, Argo CD, Rollout, runtime release task, and version state. |
| `GET` | `/api/apps/:id/versions` | Read stable/current/candidate version hints from Rollout status. |
| `POST` | `/api/apps/:id/release` | Start the publish pipeline: build, deploy, and wait for canary check. |
| `POST` | `/api/apps/:id/release/cancel` | Cancel the in-memory publish pipeline task. |
| `POST` | `/api/apps/:id/promote` | Promote the current candidate version. |
| `POST` | `/api/apps/:id/build` | Compatibility API: trigger the app build workflow directly. |
| `POST` | `/api/apps/:id/sync` | Compatibility API: trigger Argo CD sync directly. |
| `POST` | `/api/apps/:id/rollout/promote` | Compatibility API: promote the Rollout directly. |
| `POST` | `/api/apps/:id/rollout/abort` | Abort the Rollout. |
| `POST` | `/api/apps/:id/rollout/restart` | Restart the Rollout pods. |
| `GET` | `/api/cluster` | Read cluster node summary and topology guidance. |
| `POST` | `/api/cluster/join-script` | Generate a Master or Worker K3s join script. |

## Cluster Expansion

The Web console includes a `集群节点` view. It shows Master / Worker counts, node readiness, quorum guidance, and a join-script generator for later nodes.

The join-script API requires these deployment secret keys:

```text
ONECD_CLUSTER_NAME
K3S_JOIN_SERVER_URL
K3S_JOIN_TOKEN
```

`kadmctl configure-delivery` writes those values from the local bootstrap profile.

## Documentation

- `docs/architecture.md`
- `docs/configuration.md`
- `docs/deploy.md`
