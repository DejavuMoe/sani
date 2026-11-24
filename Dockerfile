# Multi-platform builds cross-compile: the first two stages run on the build
# machine's own platform, and only the binary targets the image's platform.

# 1. The admin app, built into internal/webui/dist. Only the web package of
# the pnpm workspace is installed; the docs site is not part of the image.
FROM --platform=$BUILDPLATFORM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS web
WORKDIR /src
RUN npm install --global pnpm@12.21.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches patches
COPY web/package.json web/
COPY docs/package.json docs/
RUN pnpm install --frozen-lockfile --filter sani-web
COPY web web
RUN pnpm --filter sani-web build

# 2. One static binary with the app embedded.
FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine3.24@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build
WORKDIR /src
ENV CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY --from=web /src/internal/webui/dist internal/webui/dist
ARG VERSION=dev
ARG TARGETOS TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -buildid= -X main.version=${VERSION}" -o /out/sani ./cmd/sani \
 && mkdir -p /out/data

# 3. Static Go needs no libc. Distroless maintains CA roots and time zone data.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:8ce6dd87e9823c5b48dcfb2c8604714ccb351ce59607327bcc4957448da279b5
LABEL org.opencontainers.image.title="Sani" \
      org.opencontainers.image.description="A small, fast link shortener you host yourself: one binary, one SQLite file." \
      org.opencontainers.image.source="https://github.com/DejavuMoe/sani" \
      org.opencontainers.image.documentation="https://github.com/DejavuMoe/sani/tree/master/docs/en" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /out/sani /sani
COPY --from=build --chown=65532:65532 /out/data /data
ENV SANI_LISTEN=:8080 \
    SANI_DATA_DIR=/data
USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/sani", "healthcheck"]
ENTRYPOINT ["/sani"]
