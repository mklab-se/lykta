# Lykta container image: the single-file binary on a minimal base (no shell, non-root).
# Multi-arch: linux/amd64 and linux/arm64 (Raspberry Pi 4/5, ARM servers).
#
#   docker run -p 8080:8080 -e LYKTA_TOKEN_ACME=... -v ./lykta.yaml:/config/lykta.yaml:ro \
#     ghcr.io/mklab-se/lykta

ARG BUN_VERSION=1
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build
ARG TARGETARCH
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY src ./src
COPY tsconfig.json ./
# Bun cross-compiles: build the binary for the image's architecture on the build machine
RUN case "$TARGETARCH" in \
      amd64) T=bun-linux-x64 ;; \
      arm64) T=bun-linux-arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && bun build src/cli.ts --compile --minify --sourcemap --target="$T" --outfile /out/lykta

FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/mklab-se/lykta" \
      org.opencontainers.image.description="Lykta: a GitHub Actions dashboard for wall screens" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /out/lykta /usr/local/bin/lykta
# config: mount it at /config/lykta.yaml, or put the whole file in LYKTA_CONFIG
ENV LYKTA_CONFIG_FILE=/config/lykta.yaml \
    LYKTA_HOST=0.0.0.0 \
    LYKTA_PORT=8080 \
    LYKTA_NO_UPDATE_CHECK=1
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/usr/local/bin/lykta"]
CMD ["serve"]
