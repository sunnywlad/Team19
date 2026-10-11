# Rejoue en local les contrôles de .github/workflows/ci.yml.
.PHONY: setup check secrets contrat dependances specs relay gateway response dashboard docs offchain semgrep lint-ci scan-final \
	demo demo-stop demo-status demo-reset demo-peupler scenes scene demo-smoke demo-chain-check demo-test

PRE_COMMIT := $(shell command -v pre-commit 2>/dev/null || echo .tools/venv/bin/pre-commit)

setup:
	scripts/setup-dev.sh

# Bloquants d'abord, informatifs ensuite (préfixe « - » : n'arrête pas make).
check: secrets contrat dependances specs relay gateway response dashboard demo-test docs lint-ci offchain semgrep

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

# Livrables (README.md, docs/) : formules interdites, liens et chemins cités,
# secrets, et fiche de défense égale à ce que donnent les fichiers de mesure.
docs:
	node --test "docs/outils/*.test.mjs"
	node docs/outils/verifier-docs.mjs

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

# --- Démo -------------------------------------------------------------------
# Toute la chaîne sur 127.0.0.1 : response (8790), gateway (8780), client-ia
# (8770), relais (8787), dashboard (5173). VAULT_MODE=fake par défaut : faux
# coffre en mémoire, aucun fonds, aucune chaîne. Données sous var/demo/.
demo:
	node demo/run.mjs up

# N'arrête que les processus lancés par « make demo ».
demo-stop:
	node demo/run.mjs stop

demo-status:
	@node demo/run.mjs status; true

# Archive le journal, les rapports et les bases du relais, puis repart d'un
# état neuf. Rien n'est effacé.
demo-reset:
	DEMO_MODE=1 node demo/run.mjs reset

# Scénarios de specs/acceptance/scenarios.md, joués par la vraie porte d'entrée.
# Chaque scène repart d'un état neuf. Les écarts de demo/ecarts-connus.json
# s'affichent « ÉCART CONNU » ; code de sortie non nul pour un écart non listé,
# ou pour un écart listé qui ne se produit plus.
scenes:
	DEMO_MODE=1 node --disable-warning=ExperimentalWarning demo/scenes.mjs

# Une seule scène : make scene S=4   (1, 2, 3, 4, 5, 6a, 6b, 7a, 7b, 8)
scene:
	DEMO_MODE=1 node --disable-warning=ExperimentalWarning demo/scenes.mjs $(S)

# Peuple le dashboard : les demandes des scènes à la suite, par la vraie porte
# d'entrée, sans remise à zéro entre elles. Remet d'abord la démo à zéro.
demo-peupler:
	DEMO_MODE=1 node --disable-warning=ExperimentalWarning demo/peupler.mjs

# Tests de demo/ sans aucun service : écarts connus, ports, hygiène.
demo-test:
	node --disable-warning=ExperimentalWarning --test "demo/test/*.test.mjs"

# Démo en mode fake, scènes 1, 2, 3, 4 et 8, deux fois, vérification du journal,
# recherche de secrets dans les logs, droits de var/demo/, pid périmés, arrêt.
demo-smoke:
	node demo/smoke.mjs

# Mode chain sur la doublure StubVault, sans ArgentVault : la chaîne de services
# sur anvil (anvil et forge requis). Ne prouve aucun paiement : les règles de
# paiement se jouent par « VAULT_MODE=chain make demo » puis « make scenes ».
demo-chain-check:
	node demo/chain-check.mjs
