# Rejoue en local les contrôles de .github/workflows/ci.yml.
.PHONY: setup check secrets contrat dependances semgrep lint-ci

PRE_COMMIT := $(shell command -v pre-commit 2>/dev/null || echo .tools/venv/bin/pre-commit)

setup:
	scripts/setup-dev.sh

# Bloquants d'abord, informatifs ensuite (préfixe « - » : n'arrête pas make).
check: secrets contrat dependances lint-ci semgrep

secrets:
	$(PRE_COMMIT) run --all-files
	scripts/gitleaks.sh git --config .gitleaks.toml --log-opts="--full-history HEAD" --redact --no-banner .
	scripts/test-secret-detection.sh

contrat:
	scripts/check-contracts.sh

dependances:
	scripts/check-deps.sh

semgrep:
	-scripts/check-semgrep.sh

lint-ci:
	@if command -v actionlint >/dev/null 2>&1; then actionlint; \
	else echo "lint-ci : actionlint absent, étape ignorée"; fi
