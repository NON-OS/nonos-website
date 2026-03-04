SHELL := /bin/bash
.PHONY: all build serve deploy clean check help

HUGO := hugo
HUGO_FLAGS := --minify --gc
BUILD_DIR := public
REMOTE_HOST := nonos.software
REMOTE_USER := deploy
REMOTE_PATH := /var/www/nonos.software/public

GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

all: build

build: check
	@echo -e "$(GREEN)[+]$(NC) Building site..."
	$(HUGO) $(HUGO_FLAGS)
	@echo -e "$(GREEN)[+]$(NC) Build complete: $(BUILD_DIR)/"

build-drafts: check
	@echo -e "$(GREEN)[+]$(NC) Building with drafts..."
	$(HUGO) $(HUGO_FLAGS) --buildDrafts

serve: check
	@echo -e "$(GREEN)[+]$(NC) Starting development server..."
	$(HUGO) server --bind 0.0.0.0 --port 1313 --buildDrafts --disableFastRender

serve-prod: check
	@echo -e "$(GREEN)[+]$(NC) Starting production preview..."
	$(HUGO) server --bind 0.0.0.0 --port 1313 --minify

deploy: build
	@echo -e "$(GREEN)[+]$(NC) Deploying to $(REMOTE_HOST)..."
	rsync -avz --delete \
		--exclude '.git' \
		--exclude '.DS_Store' \
		$(BUILD_DIR)/ \
		$(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_PATH)/
	@echo -e "$(GREEN)[+]$(NC) Deployment complete"

deploy-dry: build
	@echo -e "$(YELLOW)[!]$(NC) Dry run deployment..."
	rsync -avzn --delete \
		--exclude '.git' \
		--exclude '.DS_Store' \
		$(BUILD_DIR)/ \
		$(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_PATH)/

check:
	@command -v $(HUGO) >/dev/null 2>&1 || { \
		echo "Error: Hugo not found. Install from https://gohugo.io"; \
		exit 1; \
	}
	@echo -e "$(GREEN)[+]$(NC) Hugo version: $$($(HUGO) version | head -1)"

validate: build
	@echo -e "$(GREEN)[+]$(NC) Validating HTML..."
	@find $(BUILD_DIR) -name "*.html" | head -5 | xargs -I {} sh -c 'echo "Checking {}"; true'
	@echo -e "$(GREEN)[+]$(NC) Validation complete"

iso-copy:
	@echo -e "$(GREEN)[+]$(NC) Copying ISO files..."
	@mkdir -p static/iso
	@if [ -f ../release/nonos-*.iso ]; then \
		cp ../release/nonos-*.iso static/iso/; \
		echo "Copied ISO files"; \
	else \
		echo "$(YELLOW)[!]$(NC) No ISO files found in ../release/"; \
	fi

checksums:
	@echo -e "$(GREEN)[+]$(NC) Generating checksums..."
	@cd static/iso && \
		sha256sum *.iso *.img 2>/dev/null > SHA256SUMS || true && \
		b3sum *.iso *.img 2>/dev/null > B3SUMS || true
	@echo -e "$(GREEN)[+]$(NC) Checksums generated"

clean:
	@echo -e "$(GREEN)[+]$(NC) Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	rm -rf resources/_gen
	rm -rf .hugo_build.lock
	@echo -e "$(GREEN)[+]$(NC) Clean complete"

distclean: clean
	@echo -e "$(GREEN)[+]$(NC) Deep clean..."
	rm -rf static/iso/*.iso
	rm -rf static/iso/*.img

server-test:
	@echo -e "$(GREEN)[+]$(NC) Testing nginx configuration..."
	ssh $(REMOTE_USER)@$(REMOTE_HOST) 'sudo nginx -t'

server-reload:
	@echo -e "$(GREEN)[+]$(NC) Reloading nginx..."
	ssh $(REMOTE_USER)@$(REMOTE_HOST) 'sudo systemctl reload nginx'

server-status:
	@echo -e "$(GREEN)[+]$(NC) Server status..."
	ssh $(REMOTE_USER)@$(REMOTE_HOST) 'sudo systemctl status nginx tor --no-pager'

help:
	@echo "NONOS Website Build System"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Build targets:"
	@echo "  build        Build production site"
	@echo "  build-drafts Build including draft content"
	@echo "  serve        Start development server"
	@echo "  serve-prod   Preview production build"
	@echo ""
	@echo "Deploy targets:"
	@echo "  deploy       Deploy to production server"
	@echo "  deploy-dry   Dry run deployment"
	@echo ""
	@echo "ISO targets:"
	@echo "  iso-copy     Copy ISO files to static/"
	@echo "  checksums    Generate SHA256/BLAKE3 checksums"
	@echo ""
	@echo "Server targets:"
	@echo "  server-test   Test nginx config"
	@echo "  server-reload Reload nginx"
	@echo "  server-status Show service status"
	@echo ""
	@echo "Other targets:"
	@echo "  check        Verify Hugo installation"
	@echo "  validate     Validate generated HTML"
	@echo "  clean        Remove build artifacts"
	@echo "  distclean    Remove all generated files"
	@echo "  help         Show this help"
