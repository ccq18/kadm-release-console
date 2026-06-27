# Deploy KADM Release Console

## 1. Build Image

The GitHub Actions workflow builds:

```text
ghcr.io/ccq18/kadm-release-console:<tag>
```

Manual trigger:

```bash
gh workflow run build-and-publish.yaml
```

## 2. Create Runtime Secret

Do not commit real tokens. Create the secret in the cluster:

```bash
kubectl create namespace kadm --dry-run=client -o yaml | kubectl apply -f -

kubectl -n kadm create secret generic kadm-secrets \
  --from-literal=GITHUB_TOKEN=<github-token> \
  --from-literal=ARGOCD_BASE_URL=https://argocd-server.argocd.svc.cluster.local \
  --from-literal=ARGOCD_TOKEN=<argocd-token>
```

Create an image pull secret in the `kadm` namespace if the GHCR package is private:

```bash
kubectl -n kadm create secret docker-registry ghcr-cred \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<github-token>
```

## 3. Apply Argo CD Application

```bash
kubectl apply -f docs/argocd-application.yaml
```

Or apply directly:

```bash
kubectl apply -k k8s/overlays/prod
```

KADM Release Console is not exposed through Ingress by default. Access it through port-forwarding:

```bash
kubectl -n kadm port-forward svc/kadm 18080:80
```

Open:

```text
http://127.0.0.1:18080
```

Do not add a public Ingress until KADM Release Console has authentication, HTTPS, and an explicit access policy.

## 4. App Applications

Create the two app Applications from `kadm-app-configs`:

```bash
kubectl apply -f ../kadm-app-configs/apps/demo-hello/overlays/prod
kubectl apply -f ../kadm-app-configs/apps/demo-hello-spring/overlays/prod
```

The apps require:

- Argo CD repository credentials for `kadm-release-console` and `kadm-app-configs`.
- `apps/ghcr-cred` image pull secret.
- `apps/hello-db` and `apps/hellospring-db` database secrets.
- Argo Rollouts installed in the cluster.

Run each repository's first build workflow before enabling Argo CD automated sync. The initial `sha-initial` image tags are placeholders.
