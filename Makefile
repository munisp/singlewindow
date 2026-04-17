# ─── TradeGateway NGSWTP — Makefile ──────────────────────────────────────────
# Common operations for development, testing, and deployment.
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help dev build test test-watch lint format typecheck \
        db-push db-seed db-reset db-backup db-restore \
        infra-up infra-down infra-logs infra-status \
        smoke-test security-audit \
        docker-build docker-push \
        clean

# ── Colours ───────────────────────────────────────────────────────────────────
BLUE   := \033[0;34m
GREEN  := \033[0;32m
YELLOW := \033[1;33m
RED    := \033[0;31m
NC     := \033[0m

# ── Variables ─────────────────────────────────────────────────────────────────
APP_NAME        := tradegateway-ngswtp
VERSION         := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
DOCKER_REGISTRY := ghcr.io/tradegateway
DB_URL          := postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway
BASE_URL        := http://localhost:3000

# ─────────────────────────────────────────────────────────────────────────────
help: ## Show this help message
	@echo ""
	@echo "$(BLUE)TradeGateway NGSWTP — Make Targets$(NC)"
	@echo "$(BLUE)═══════════════════════════════════$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""

# ── Development ───────────────────────────────────────────────────────────────
dev: ## Start development server
	@echo "$(YELLOW)Starting development server...$(NC)"
	DATABASE_URL=$(DB_URL) pnpm dev

build: ## Build production bundle
	@echo "$(YELLOW)Building production bundle...$(NC)"
	pnpm build
	@echo "$(GREEN)Build complete!$(NC)"

# ── Testing ───────────────────────────────────────────────────────────────────
test: ## Run full test suite
	@echo "$(YELLOW)Running test suite...$(NC)"
	DATABASE_URL=$(DB_URL) pnpm test
	@echo "$(GREEN)All tests passed!$(NC)"

test-watch: ## Run tests in watch mode
	DATABASE_URL=$(DB_URL) pnpm vitest

test-coverage: ## Run tests with coverage report
	DATABASE_URL=$(DB_URL) pnpm vitest run --coverage

smoke-test: ## Run smoke tests against running server
	@echo "$(YELLOW)Running smoke tests against $(BASE_URL)...$(NC)"
	@bash scripts/smoke-test.sh $(BASE_URL)

# ── Code Quality ──────────────────────────────────────────────────────────────
lint: ## Run ESLint
	pnpm eslint . --ext .ts,.tsx

format: ## Format code with Prettier
	pnpm format

typecheck: ## Run TypeScript type check
	@echo "$(YELLOW)Running TypeScript check...$(NC)"
	npx tsc --noEmit --skipLibCheck
	@echo "$(GREEN)TypeScript: 0 errors$(NC)"

security-audit: ## Run security audit
	@echo "$(YELLOW)Running security audit...$(NC)"
	pnpm audit
	@echo "$(YELLOW)Security report: docs/SECURITY-AUDIT.md$(NC)"

# ── Database ──────────────────────────────────────────────────────────────────
db-push: ## Push schema changes to database
	@echo "$(YELLOW)Pushing schema to database...$(NC)"
	DATABASE_URL=$(DB_URL) pnpm db:push

db-seed: ## Seed database with comprehensive demo data
	@echo "$(YELLOW)Seeding database...$(NC)"
	DATABASE_URL=$(DB_URL) node scripts/seed-comprehensive.mjs
	@echo "$(GREEN)Database seeded!$(NC)"

db-reset: ## Reset database (DROP + recreate + seed)
	@echo "$(RED)WARNING: This will drop all data!$(NC)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	PGPASSWORD=tradegateway_secure_2026 psql -h localhost -U tradegateway -c "DROP DATABASE IF EXISTS tradegateway;"
	PGPASSWORD=tradegateway_secure_2026 psql -h localhost -U tradegateway -c "CREATE DATABASE tradegateway;"
	$(MAKE) db-push
	$(MAKE) db-seed
	@echo "$(GREEN)Database reset complete!$(NC)"

db-backup: ## Backup database to file
	@echo "$(YELLOW)Backing up database...$(NC)"
	@mkdir -p backups
	PGPASSWORD=tradegateway_secure_2026 pg_dump -h localhost -U tradegateway tradegateway \
		> backups/tradegateway-$(shell date +%Y%m%d-%H%M%S).sql
	@echo "$(GREEN)Backup saved to backups/$(NC)"

db-restore: ## Restore database from latest backup
	@echo "$(YELLOW)Restoring from latest backup...$(NC)"
	@LATEST=$$(ls -t backups/*.sql 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then echo "$(RED)No backup found!$(NC)"; exit 1; fi; \
	PGPASSWORD=tradegateway_secure_2026 psql -h localhost -U tradegateway tradegateway < $$LATEST
	@echo "$(GREEN)Restore complete!$(NC)"

# ── Infrastructure ────────────────────────────────────────────────────────────
infra-up: ## Start all middleware services (Kafka, Redis, Permify, etc.)
	@echo "$(YELLOW)Starting infrastructure services...$(NC)"
	docker compose -f infra/docker-compose.yml up -d
	@echo "$(GREEN)Infrastructure started! Check status with: make infra-status$(NC)"

infra-down: ## Stop all middleware services
	@echo "$(YELLOW)Stopping infrastructure services...$(NC)"
	docker compose -f infra/docker-compose.yml down
	@echo "$(GREEN)Infrastructure stopped$(NC)"

infra-logs: ## Show logs from all services
	docker compose -f infra/docker-compose.yml logs -f

infra-status: ## Show status of all services
	docker compose -f infra/docker-compose.yml ps

infra-reset: ## Reset all services (removes volumes)
	@echo "$(RED)WARNING: This will remove all service data!$(NC)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	docker compose -f infra/docker-compose.yml down -v
	@echo "$(GREEN)Infrastructure reset$(NC)"

# ── Docker ────────────────────────────────────────────────────────────────────
docker-build: ## Build Docker image
	@echo "$(YELLOW)Building Docker image...$(NC)"
	docker build -t $(DOCKER_REGISTRY)/$(APP_NAME):$(VERSION) \
		-t $(DOCKER_REGISTRY)/$(APP_NAME):latest .
	@echo "$(GREEN)Image built: $(DOCKER_REGISTRY)/$(APP_NAME):$(VERSION)$(NC)"

docker-push: ## Push Docker image to registry
	@echo "$(YELLOW)Pushing Docker image...$(NC)"
	docker push $(DOCKER_REGISTRY)/$(APP_NAME):$(VERSION)
	docker push $(DOCKER_REGISTRY)/$(APP_NAME):latest
	@echo "$(GREEN)Image pushed!$(NC)"

# ── CI/CD ─────────────────────────────────────────────────────────────────────
ci: ## Run full CI pipeline (typecheck + test + build)
	@echo "$(BLUE)Running CI pipeline...$(NC)"
	$(MAKE) typecheck
	$(MAKE) test
	$(MAKE) build
	@echo "$(GREEN)CI pipeline passed!$(NC)"

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean: ## Clean build artifacts
	@echo "$(YELLOW)Cleaning build artifacts...$(NC)"
	rm -rf dist/ coverage/ .turbo/
	@echo "$(GREEN)Clean complete!$(NC)"

# ── Quick Start ───────────────────────────────────────────────────────────────
setup: ## First-time setup (install deps + push DB + seed)
	@echo "$(BLUE)Setting up TradeGateway NGSWTP...$(NC)"
	pnpm install
	$(MAKE) db-push
	$(MAKE) db-seed
	@echo ""
	@echo "$(GREEN)Setup complete! Run 'make dev' to start the server.$(NC)"
	@echo "$(GREEN)Demo login: http://localhost:3000/api/demo/session$(NC)"
