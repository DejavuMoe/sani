.PHONY: install check test build web binary dist dev-backend dev-frontend demo e2e bench load docker docs docs-dev clean

# Run through mise when it is installed, so the pinned toolchain is used.
RUN     ?= $(shell command -v mise >/dev/null 2>&1 && echo "mise exec --")
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

# One pnpm workspace: web/ (the admin app) and docs/ (the documentation site).
install:
	$(RUN) pnpm install --frozen-lockfile

# Formatting, vet and type checks, and the docs-against-source sync check.
check:
	@test -z "$($(RUN) gofmt -l cmd internal scripts)" || ($(RUN) gofmt -l cmd internal scripts; echo "run gofmt -w" >&2; exit 1)
	$(RUN) go vet ./...
	$(RUN) pnpm --dir web check
	$(RUN) pnpm --dir docs check

test:
	$(RUN) go test -race ./...
	$(RUN) pnpm --dir web test

# The frontend builds into internal/webui/dist, which the binary embeds.
web:
	$(RUN) pnpm --dir web build

binary:
	CGO_ENABLED=0 $(RUN) go build -trimpath -ldflags "$(LDFLAGS)" -o bin/sani ./cmd/sani

build: web binary

# Release archives for every platform, and SHA256SUMS, in dist/.
dist:
	VERSION=$(VERSION) $(RUN) bash scripts/dist.sh

dev-backend:
	SANI_LISTEN=127.0.0.1:8080 SANI_DATA_DIR=./data $(RUN) go run ./cmd/sani

# Vite on 127.0.0.1:5173/admin/, proxying /api to dev-backend.
dev-frontend:
	$(RUN) pnpm --dir web dev

# A throwaway instance with believable data. Password: sani-demo
demo: build
	rm -rf ./data/demo
	$(RUN) go run ./scripts/seed -data ./data/demo -password sani-demo
	SANI_LISTEN=127.0.0.1:8080 SANI_DATA_DIR=./data/demo ./bin/sani

e2e: build
	$(RUN) pnpm --dir web e2e

bench:
	$(RUN) go test -run '^$$' -bench . -benchmem ./internal/...

# Redirect throughput and latency against a local release build.
load: binary
	$(RUN) ./scripts/load.sh

docker:
	docker build --build-arg VERSION=$(VERSION) -t sani:$(VERSION) -t sani:latest .

# The documentation site: a static build in docs/.vitepress/dist, or a live
# preview on 127.0.0.1:5174.
docs:
	$(RUN) pnpm --dir docs build

docs-dev:
	$(RUN) pnpm --dir docs dev

clean:
	rm -rf bin dist
	find internal/webui/dist -mindepth 1 ! -name .gitkeep -delete
