# 1. The admin app, built into internal/webui/dist. Only the web package of
# the pnpm workspace is installed; the docs site is not part of the image.
FROM node:24-alpine AS web
WORKDIR /src
RUN npm install --global pnpm@12.5.1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json web/
COPY docs/package.json docs/
RUN pnpm install --frozen-lockfile --filter sani-web
COPY web web
RUN pnpm --filter sani-web build

# 2. One static binary with the app embedded.
FROM golang:1.27-alpine AS build
RUN apk add --no-cache ca-certificates
WORKDIR /src
ENV CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY --from=web /src/internal/webui/dist internal/webui/dist
ARG VERSION=dev
RUN go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/sani ./cmd/sani \
 && mkdir -p /out/data

# 3. Nothing else: the binary, CA roots for title fetching, and a data volume.
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/sani /sani
COPY --from=build --chown=65532:65532 /out/data /data
ENV SANI_LISTEN=:8080 \
    SANI_DATA_DIR=/data
USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/sani", "healthcheck"]
ENTRYPOINT ["/sani"]
