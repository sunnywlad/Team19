# Rejoue en local les contrôles de .github/workflows/ci.yml.
.PHONY: setup check secrets contrat dependances specs relay gateway response dashboard offchain semgrep lint-ci scan-final

PRE_COMMIT := $(shell command -v pre-commit 2>/dev/null || echo .tools/venv/bin/pre-commit)

setup:
	scripts/setup-dev.sh

# Bloquants d'abord, informatifs ensuite (préfixe « - » : n'arrête pas make).
check: secrets contrat dependances specs relay gateway response dashboard lint-ci offchain semgrep

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

# Types et tests de gateway/ (porte d'entrée, détecteur).
gateway:
	gateway/tools/check.sh

# Types et tests de response/ (journal chaîné, réactions, rapports).
response:
	response/tools/check.sh

# Lint de sécurité, types, tests et contrôle du bundle de dashboard/.
dashboard:
	dashboard/tools/check.sh

# Tests de offchain/ (cache, passerelle, vérificateur). Informatif tant que
# offchain/cache/server.ts n'est pas versionné.
offchain:
	-offchain/tools/check.sh

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
