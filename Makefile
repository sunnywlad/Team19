# Rejoue en local les contrôles de .github/workflows/ci.yml.
.PHONY: setup check secrets contrat dependances specs relay semgrep lint-ci scan-final

PRE_COMMIT := $(shell command -v pre-commit 2>/dev/null || echo .tools/venv/bin/pre-commit)

setup:
	scripts/setup-dev.sh

# Bloquants d'abord, informatifs ensuite (préfixe « - » : n'arrête pas make).
check: secrets contrat dependances specs relay lint-ci semgrep

secrets:
	$(PRE_COMMIT) run --all-files
	scripts/gitleaks.sh git --config .gitleaks.toml --log-opts="--full-history HEAD" --redact --no-banner .
	scripts/test-secret-detection.sh

contrat:
	scripts/check-contracts.sh

dependances:
	scripts/check-deps.sh

# Chaque exemple de specs/examples validé contre son schéma (ajv épinglé).
specs:
	specs/tools/check.sh

# Types et tests de relay/ (scénarios 1, 5 et 8, idempotence, reprise).
relay:
	relay/tools/check.sh

semgrep:
	-scripts/check-semgrep.sh

lint-ci:
	@if command -v actionlint >/dev/null 2>&1; then actionlint; \
	else echo "lint-ci : actionlint absent, étape ignorée"; fi

# Scan de livraison : toutes les refs (branches locales, distantes, tags),
# pas seulement l'historique de HEAD. Récupère d'abord les refs du dépôt
# distant, sinon le scan porterait sur un état périmé ; FETCH=0 pour s'en
# passer (hors ligne), en connaissance de cause.
FETCH ?= 1
scan-final:
ifeq ($(FETCH),1)
	git fetch --all --prune --tags
else
	@echo "scan-final : FETCH=0, refs distantes NON rafraîchies"
endif
	scripts/gitleaks.sh git --config .gitleaks.toml --log-opts="--all" --redact --no-banner --verbose .
