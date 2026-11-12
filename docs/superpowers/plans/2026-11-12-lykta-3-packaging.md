# Packaging, Deployment and MCP (plan 3)

**Goal:** Lykta can be put on a wall by anyone in minutes: a container image, a Helm chart (with
Argo CD), plain manifests, guides, and an MCP endpoint for AI harnesses.

**Spec:** `docs/superpowers/specs/2026-11-12-lykta-dashboard-design.md` (sections 4 and 9), plus
the decisions made with Kristofer on 2026-11-12: ghcr.io first; Helm, not Kustomize; MCP read-only
and opt-in, filterable by label.

## Tasks (done)

1. **Container image** (`Dockerfile`): the single-file binary cross-compiled for linux/amd64 and
   linux/arm64 on the build machine, on `gcr.io/distroless/cc-debian12:nonroot`; config from
   `/config/lykta.yaml` or `LYKTA_CONFIG`; update check off. Verified locally: demo, `serve`
   against GitHub, MCP, read-only root filesystem. 64 MB.
2. **Publishing** (`release.yml`): image to `ghcr.io/mklab-se/lykta` (`X.Y.Z`, `X.Y`, `latest`,
   SBOM and provenance) and the chart to `oci://ghcr.io/mklab-se/charts/lykta`. CI lints the
   chart and smoke-tests the image (read-only, page, MCP).
3. **Helm chart** (`deploy/helm/lykta`): ConfigMap from `config`, Secret by name
   (`existingSecret`), probes, restricted security context, optional Ingress with buffering off,
   `mcp.enabled`.
4. **Plain manifests** (`deploy/kubernetes/lykta.yaml`) rendered from the chart, and **Compose**
   (`deploy/compose`).
5. **Guides**: `docs/docker.md`, `docs/kubernetes.md` (Helm, Argo CD, plain), `docs/github-app.md`,
   `docs/mcp.md`; INSTALL.md.
6. **MCP** (`src/server/mcp.ts`): Streamable HTTP, stateless JSON; tools `list_workflows`,
   `list_failures`, `list_labels`, `get_workflow`; label filters; build output as
   `untrustedBuildOutput`. Tested with the official SDK client.

## Rulings

- MCP is served by Lykta itself rather than through the SDK at runtime: four read-only tools over
  stateless JSON are small, and Lykta keeps a single runtime dependency. Cost if wrong: a future
  protocol feature means more code here; the SDK-based test catches incompatibilities.
- No HEALTHCHECK in the image (distroless has no shell or curl): orchestrators use `/healthz` and
  `/readyz`. Cost if wrong: plain `docker ps` shows no health.
- 32-bit ARM (Raspberry Pi 3 and older with a 32-bit OS) is not supported: Bun builds for 64-bit
  only.
