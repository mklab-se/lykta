# Run Lykta with Docker

The fastest way to put Lykta on a wall: one container, one configuration file, one token.
The image is `ghcr.io/mklab-se/lykta` (linux/amd64 and linux/arm64, so a Raspberry Pi 4 or 5
works too). It runs as a non-root user on a minimal base without a shell.

## Try it first, without GitHub

```sh
docker run --rm -p 8080:8080 ghcr.io/mklab-se/lykta demo
```

Open <http://localhost:8080>: simulated workflows run, fail and recover on a fast clock.

## 1. A token that can read your workflows

Lykta only reads. Create a **fine-grained personal access token** on GitHub (Settings, Developer
settings, Fine-grained tokens):

- **Resource owner:** the organization whose workflows you want on the wall.
- **Repository access:** the repositories you will monitor (or all of them).
- **Permissions:** *Actions: Read-only* and *Contents: Read-only* (Metadata is added for you).

Some organizations must approve fine-grained tokens before they work; an organization owner does
that under the organization's settings. For a shared, long-lived wall, a GitHub App is the better
choice: see [GitHub App setup](github-app.md).

## 2. A configuration file

Save this as `lykta.yaml` and adapt it (all options: [`lykta.example.yaml`](../lykta.example.yaml)):

```yaml
title: Our builds

organizations:
  acme:              # the GitHub organization (or user) name
    auth: token

monitor:             # one entry = one tile, shown in this order
  - repo: acme/android
    workflow: nightly.yml
    labels: [mobile]       # optional: shown as #mobile, filterable over MCP
    color: "#a78bfa"       # optional: the tile's border
  - repo: acme/web
    workflow: ci.yml
  - repo: acme/web
    workflow: deploy.yml
    branch: release        # default: main
```

The token goes in an environment variable named after the organization:
`LYKTA_TOKEN_<ORG>`, upper case, with `-` and `.` as `_` (`acme-corp` becomes
`LYKTA_TOKEN_ACME_CORP`). It never goes in the file.

## 3. Check it before it goes on the wall

```sh
export LYKTA_TOKEN_ACME=github_pat_...
docker run --rm -e LYKTA_TOKEN_ACME \
  -v "$PWD/lykta.yaml:/config/lykta.yaml:ro" \
  ghcr.io/mklab-se/lykta check
```

`check` signs in, reads every workflow once and prints what the wall would show, so a typo in a
repository or workflow name shows up here and not on the screen.

## 4. Run it

```sh
docker run -d --name lykta --restart unless-stopped \
  -p 8080:8080 \
  -e LYKTA_TOKEN_ACME \
  -v "$PWD/lykta.yaml:/config/lykta.yaml:ro" \
  ghcr.io/mklab-se/lykta
```

Open `http://<that machine>:8080` on the screen. On a kiosk, start the browser full screen, for
example `chromium --kiosk --noerrdialogs http://lykta.internal:8080`. Lykta recovers by itself
from network drops and restarts, reloads the page when a new version is deployed, and switches to
a low-power mode on weak hardware.

With Docker Compose: [`deploy/compose/docker-compose.yaml`](../deploy/compose/docker-compose.yaml).

## Settings worth knowing

| Variable | Meaning |
| --- | --- |
| `LYKTA_TOKEN_<ORG>` | Token for an organization (or `LYKTA_TOKEN_<ORG>_FILE` with a path) |
| `LYKTA_APP_ID`, `LYKTA_APP_PRIVATE_KEY` | GitHub App credentials instead of tokens (or `..._FILE`) |
| `LYKTA_CONFIG` | The whole `lykta.yaml` as a value, instead of a mounted file |
| `LYKTA_TITLE` | The title in the header |
| `LYKTA_MCP=on` | The read-only [MCP endpoint](mcp.md) at `/mcp`, for AI harnesses |
| `LYKTA_LOW_POWER=on` | Fewer effects, for weak screens (`auto` by default) |
| `HTTPS_PROXY`, `NO_PROXY` | An outgoing proxy, if the network needs one |
| `NODE_EXTRA_CA_CERTS` | A file with extra CA certificates (mount it), for TLS-inspecting proxies |

Health: `/healthz` answers when the process runs, `/readyz` once the first sync with GitHub is
done.

## When something is wrong

- `docker logs lykta` shows a line whenever the counts change, and every warning.
- A red **not found** card names the workflow it could not read: a renamed or deleted workflow
  file, a wrong branch, or a token without access to that repository.
- **No access ... needs actions=read**: the token lacks the Actions permission for that
  repository.
- **Cannot sign in to acme**: the token is missing, expired or not approved by the organization.
- A banner "GitHub rate limit for acme: data delayed until 13:00": GitHub asked Lykta to slow
  down; it pauses that organization until then and catches up by itself. Lykta keeps to a fifth
  of each organization's hourly limit (`polling.budget`) so other tools sharing it keep working.
