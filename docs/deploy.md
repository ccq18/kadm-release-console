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
kubectl create namespace onecd --dry-run=client -o yaml | kubectl apply -f -

kubectl -n onecd create secret generic onecd-secrets \
  --from-literal=GITHUB_TOKEN=<github-token> \
  --from-literal=ARGOCD_BASE_URL=http://argocd-server.argocd.svc.cluster.local \
  --from-literal=ARGOCD_TOKEN=<argocd-token>
```

Create an image pull secret in the `onecd` namespace if the GHCR package is private:

```bash
kubectl -n onecd create secret docker-registry ghcr-cred \
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
kubectl -n onecd port-forward svc/onecd 18080:80
```

Open:

```text
http://127.0.0.1:18080
```

Do not add a public Ingress until KADM Release Console has authentication, HTTPS, and an explicit access policy.

## 4. App Applications

Create the two app Applications from their repositories:

```bash
kubectl apply -f ../demo-hello/docs/argocd-application.yaml
kubectl apply -f ../demo-hello-spring/docs/argocd-application.yaml
```

The apps require:

- Argo CD repository credentials for the three GitHub SSH repositories.
- `apps/ghcr-cred` image pull secret.
- `apps/hello-db` and `apps/hellospring-db` database secrets.
- Argo Rollouts installed in the cluster.

Run each repository's first build workflow before enabling Argo CD automated sync. The initial `sha-initial` image tags are placeholders.
