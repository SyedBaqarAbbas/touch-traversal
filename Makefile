SHELL := /bin/sh

PNPM ?= pnpm
UV ?= uv
WEB_PACKAGE := @touch-traversal/web
PIPELINE_DIR := pipeline
SAMPLE_NOTES_DIR := sample-notes
GRAPH_OUTPUT_DIR := apps/web/public/data
PIPELINE_CONFIG := config/default.yaml

.DEFAULT_GOAL := help

.PHONY: help doctor check-node check-pnpm check-uv check-web check-pipeline
.PHONY: install dev build build-graph verify-root test test-e2e lint typecheck format format-check

help: ## Show the available project commands.
	@awk 'BEGIN { FS = ":.*## "; printf "Touch Traversal commands:\n\n" } /^[a-zA-Z_-]+:.*## / { printf "  %-14s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

doctor: check-node check-pnpm check-uv ## Verify the required root development tools.
	@printf '%s\n' "Toolchain checks passed."

check-node:
	@command -v node >/dev/null 2>&1 || { printf '%s\n' "error: Node.js 22+ is required. Install it, then rerun this command." >&2; exit 1; }
	@node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 22 || major >= 25) { console.error("error: Node.js 22–24 is required; found " + process.versions.node + "."); process.exit(1); }'

check-pnpm: check-node
	@command -v $(PNPM) >/dev/null 2>&1 || { printf '%s\n' "error: pnpm 10 is required. Run 'corepack enable' and retry." >&2; exit 1; }
	@$(PNPM) --version >/dev/null 2>&1 || { printf '%s\n' "error: pnpm could not start. Run 'corepack enable', ensure registry access, and retry." >&2; exit 1; }

check-uv:
	@command -v $(UV) >/dev/null 2>&1 || { printf '%s\n' "error: uv is required for the Python pipeline. Install uv, then retry." >&2; exit 1; }

check-web:
	@test -f apps/web/package.json || { printf '%s\n' "error: apps/web is not scaffolded yet; complete THO-15 first." >&2; exit 1; }

check-pipeline:
	@test -f $(PIPELINE_DIR)/pyproject.toml || { printf '%s\n' "error: pipeline/pyproject.toml is not scaffolded yet; complete THO-16 first." >&2; exit 1; }

install: check-pnpm check-uv check-pipeline ## Install JavaScript and Python dependencies.
	$(PNPM) install --frozen-lockfile --optimistic-repeat-install
	cd $(PIPELINE_DIR) && $(UV) sync --extra embeddings --extra layouts --all-groups --locked

dev: check-pnpm check-web ## Start the Next.js development server.
	$(PNPM) --filter $(WEB_PACKAGE) dev

build: check-pnpm check-web ## Build the production web application.
	$(PNPM) --filter $(WEB_PACKAGE) build

build-graph: check-uv check-pipeline ## Build graph artifacts from the sample corpus.
	cd $(PIPELINE_DIR) && $(UV) run touch-traversal build --input ../$(SAMPLE_NOTES_DIR) --output ../$(GRAPH_OUTPUT_DIR) --config $(PIPELINE_CONFIG)

verify-root: check-pnpm ## Verify the root workspace files and command contract.
	$(PNPM) run test:root

test: check-pnpm check-uv check-web check-pipeline ## Run frontend and pipeline tests.
	$(PNPM) run test:root
	$(PNPM) --filter $(WEB_PACKAGE) test
	cd $(PIPELINE_DIR) && $(UV) run pytest

test-e2e: check-pnpm check-web ## Run browser smoke tests against a managed dev server.
	$(PNPM) --filter $(WEB_PACKAGE) test:e2e

lint: check-pnpm check-uv check-web check-pipeline ## Run frontend and pipeline linters.
	$(PNPM) --filter $(WEB_PACKAGE) lint
	cd $(PIPELINE_DIR) && $(UV) run ruff check .

typecheck: check-pnpm check-uv check-web check-pipeline ## Run TypeScript and Python type checks.
	$(PNPM) --filter $(WEB_PACKAGE) typecheck
	cd $(PIPELINE_DIR) && $(UV) run mypy touch_traversal tests

format: check-pnpm check-uv check-web check-pipeline ## Format frontend and pipeline source files.
	$(PNPM) --filter $(WEB_PACKAGE) format
	cd $(PIPELINE_DIR) && $(UV) run ruff format .

format-check: check-pnpm check-uv check-web check-pipeline ## Verify formatting without changing files.
	$(PNPM) --filter $(WEB_PACKAGE) format:check
	cd $(PIPELINE_DIR) && $(UV) run ruff format --check .
