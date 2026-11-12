# Run Lykta on Kubernetes

Three ways, from most to least managed: the Helm chart with Argo CD, the Helm chart on its own,
or plain manifests. Lykta is a single small pod (25m CPU, 64 MiB to start) that keeps no state;
one replica is enough for any number of screens.

## Secrets first

Tokens and keys live in a Secret; the chart only refers to it by name (`lykta-secrets` by
default). Every key in it becomes an environment variable:

```sh
# fine-grained token per organization
kubectl create secret generic lykta-secrets -n lykta \
  --from-literal=LYKTA_TOKEN_ACME=github_pat_...

# or a GitHub App (see github-app.md)
kubectl create secret generic lykta-secrets -n lykta \
  --from-literal=LYKTA_APP_ID=123456 \
  --from-file=LYKTA_APP_PRIVATE_KEY=lykta.pem
```

With External Secrets, Sealed Secrets or Vault, create a Secret with the same keys instead.

## Helm

The chart is published as an OCI artifact next to the image:

```sh
helm install lykta oci://ghcr.io/mklab-se/charts/lykta -n lykta --create-namespace \
  -f my-values.yaml
```

`my-values.yaml` holds the wall's configuration (the contents of `lykta.yaml`) and, if wanted,
an Ingress:

```yaml
config: |
  title: Platform builds
  organizations:
    acme:
      auth: token
  monitor:
    - repo: acme/android
      workflow: nightly.yml
      labels: [mobile]
      color: "#a78bfa"
    - repo: acme/web
      workflow: ci.yml

ingress:
  enabled: true
  className: nginx
  host: lykta.internal.acme.com

mcp:
  enabled: false   # true: read-only MCP at /mcp for AI harnesses
```

All values: [`deploy/helm/lykta/values.yaml`](../deploy/helm/lykta/values.yaml). A changed
`config` rolls the pod by itself. The Ingress turns off response buffering: the wall keeps one
long-lived event stream open per screen.

## Argo CD

An `Application` pointing at the OCI chart:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: lykta
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ghcr.io/mklab-se/charts
    chart: lykta
    targetRevision: 0.1.0
    helm:
      valuesObject:
        config: |
          title: Platform builds
          organizations:
            acme:
              auth: token
          monitor:
            - repo: acme/web
              workflow: ci.yml
        ingress:
          enabled: true
          host: lykta.internal.acme.com
  destination:
    server: https://kubernetes.default.svc
    namespace: lykta
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

Argo CD needs the OCI registry declared once (it is public, so no credentials):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ghcr-charts
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: helm
  name: ghcr-charts
  url: ghcr.io/mklab-se/charts
  enableOCI: "true"
```

Keep the Secret with the tokens out of Git (create it as above, or manage it with External
Secrets). To follow new releases, raise `targetRevision`, or let Argo CD Image Updater do it.

## Plain manifests

[`deploy/kubernetes/lykta.yaml`](../deploy/kubernetes/lykta.yaml) is the chart rendered with
its defaults: a ConfigMap (edit its `lykta.yaml`), a Deployment and a Service.

```sh
kubectl create namespace lykta
kubectl -n lykta create secret generic lykta-secrets --from-literal=LYKTA_TOKEN_MY_ORG=...
kubectl -n lykta apply -f deploy/kubernetes/lykta.yaml
kubectl -n lykta port-forward svc/lykta 8080:80
```

## What the pod looks like

- Image `ghcr.io/mklab-se/lykta:<version>`, non-root, read-only root filesystem, all
  capabilities dropped, a small `/tmp`.
- Probes: `/healthz` (liveness) and `/readyz` (ready once the first sync with GitHub is done).
- Outgoing HTTPS to `api.github.com` and GitHub's log storage
  (`*.actions.githubusercontent.com`, `*.blob.core.windows.net`). Behind a proxy, set
  `HTTPS_PROXY` and `NO_PROXY` under `env`.
