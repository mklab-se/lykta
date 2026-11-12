# GitHub App setup

A GitHub App is the best way to connect a shared, long-lived wall: it is not tied to one person,
it can be installed on exactly the repositories you want, its tokens are short-lived (Lykta
renews them by itself), and an installation gets its own rate limit (5,000 requests an hour,
more in large organizations) instead of sharing a person's.

You need to be an organization owner (or have an owner approve the installation).

## 1. Create the App

In the organization: **Settings, Developer settings, GitHub Apps, New GitHub App**.

| Field | Value |
| --- | --- |
| Name | `Lykta (<your team or wall>)`; names are unique across GitHub |
| Homepage URL | your wall's address, or `https://github.com/mklab-se/lykta` |
| Webhook | untick **Active** (Lykta polls; it needs no webhooks) |
| Repository permissions | **Actions: Read-only**, **Contents: Read-only** (Metadata is added for you) |
| Organization permissions | none |
| Where can it be installed | **Only on this account** |

Create it, then note the **App ID** at the top of its settings page.

## 2. A private key

On the same page, under **Private keys**, choose **Generate a private key**. A `.pem` file is
downloaded. Keep it like a password: whoever has it can read your workflows.

## 3. Install it

**Install App** in the left menu, choose the organization, and pick the repositories whose
workflows should be on the wall (or all repositories). Lykta finds the installation by itself.

## 4. Tell Lykta

In `lykta.yaml`, the organization signs in with the App:

```yaml
organizations:
  acme:
    auth: app
```

and the App's credentials go in environment variables (never in the file):

```sh
LYKTA_APP_ID=123456
LYKTA_APP_PRIVATE_KEY_FILE=/secrets/lykta.pem    # or LYKTA_APP_PRIVATE_KEY with the key itself
```

With Docker:

```sh
docker run -d -p 8080:8080 \
  -e LYKTA_APP_ID=123456 \
  -e LYKTA_APP_PRIVATE_KEY_FILE=/secrets/lykta.pem \
  -v "$PWD/lykta.pem:/secrets/lykta.pem:ro" \
  -v "$PWD/lykta.yaml:/config/lykta.yaml:ro" \
  ghcr.io/mklab-se/lykta
```

In Kubernetes, put both in the Secret the chart reads (see [Kubernetes](kubernetes.md)):

```sh
kubectl create secret generic lykta-secrets \
  --from-literal=LYKTA_APP_ID=123456 \
  --from-file=LYKTA_APP_PRIVATE_KEY=lykta.pem
```

One App can serve several organizations if it is made public and installed in each of them; every
organization listed with `auth: app` uses the same App ID and key.

Run `lykta check` (or `docker run ... ghcr.io/mklab-se/lykta check`) to confirm that Lykta signs
in and can read every workflow before it goes on the wall.
