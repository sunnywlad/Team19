#!/usr/bin/env bash
# Contrôle des contrats : forge test, puis slither. Une alerte slither de
# gravité haute bloque, sauf dérogation datée dans .slither-waivers.txt
# (expirée ou mal formée : échec aussi).
# Le projet Foundry est à la racine du dépôt (foundry.toml, sources dans src/).
# Un projet Foundry sans aucune source est une erreur : le contrôle échoue
# plutôt que de passer sans rien avoir regardé.
# Usage : scripts/check-contracts.sh [--detect]
#   --detect : sort en 0 s'il y a un projet Foundry à contrôler, en 1 sinon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

has_project() { [ -f foundry.toml ]; }
has_sources() {
  [ -d src ] && [ -n "$(find src -type f -name '*.sol' -print -quit)" ]
}

if [ "${1:-}" = "--detect" ]; then
  has_project
  exit $?
fi

if ! has_project; then
  echo "contrat : pas de projet Foundry (foundry.toml absent), rien à analyser"
  exit 0
fi
if ! has_sources; then
  echo "contrat : foundry.toml présent mais aucun .sol dans src/, contrôle impossible" >&2
  exit 1
fi
if [ ! -f lib/forge-std/src/Test.sol ]; then
  echo "contrat : lib/forge-std absent (git submodule update --init --recursive)" >&2
  exit 1
fi

for tool in forge slither python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "contrat : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

echo "==> forge test"
forge test
echo "==> slither (gravité haute bloquante, sauf dérogation datée)"
# Seul src/ est jugé : dépendances, tests, scripts de déploiement et doublures
# des autres dossiers sont écartés. slither ne décide pas de l'issue
# (--fail-none) : c'est la lecture de son rapport JSON, plus bas, qui tranche.
WAIVERS="${SLITHER_WAIVERS:-$ROOT/.slither-waivers.txt}"
REPORT="$(mktemp "${TMPDIR:-/tmp}/slither.XXXXXX")"
rm -f "$REPORT" # slither refuse d'écrire dans un fichier qui existe déjà
trap 'rm -f "$REPORT"' EXIT

slither . --fail-none --json "$REPORT" \
  --filter-paths '(^|/)(lib|node_modules|test|script|offchain|relay)/' ||
  { echo "contrat : slither n'a pas pu analyser le projet" >&2; exit 1; }

# Dérogations : « détecteur | fichier:fonction | raison | AAAA-MM-JJ » (voir
# .slither-waivers.txt). Chaque alerte haute doit en avoir une, non expirée.
python3 -I - "$REPORT" "$WAIVERS" "$(date -u +%Y-%m-%d)" << 'PY'
import json, os, re, sys

report_path, waivers_path, today = sys.argv[1:4]
failures = []

def warn(message):
    # Annotation visible dans l'interface GitHub, simple message en local.
    print(("::warning::" if os.environ.get("GITHUB_ACTIONS") else "ATTENTION ") + message)

try:
    with open(report_path, encoding="utf-8") as handle:
        report = json.load(handle)
except (OSError, ValueError):
    sys.exit("ECHEC contrat : rapport slither illisible")
if not report.get("success"):
    sys.exit("ECHEC contrat : slither a échoué, aucune alerte n'a pu être lue")
detectors = (report.get("results") or {}).get("detectors") or []

DETECTOR = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TARGET = re.compile(r"^[^|:\s]+\.sol:[A-Za-z_][A-Za-z0-9_]*$")
DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")

# clé (détecteur, fichier:fonction) -> ligne, pour les dérogations en vigueur
active = {}
name = os.path.basename(waivers_path)
if os.path.exists(waivers_path):
    with open(waivers_path, encoding="utf-8") as handle:
        for number, raw in enumerate(handle, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            fields = [field.strip() for field in line.split("|")]
            if len(fields) != 4 or not DETECTOR.match(fields[0]) or not TARGET.match(fields[1]) or not fields[2] or not DATE.match(fields[3]):
                failures.append(f"{name}:{number} : attendu « détecteur | fichier:fonction | raison | AAAA-MM-JJ »")
                continue
            detector, target, reason, expiry = fields
            if expiry < today:
                failures.append(f"{name}:{number} : dérogation {detector} sur {target} expirée le {expiry}")
                continue
            active[(detector, target)] = (number, reason, expiry)

def target_of(finding):
    """fichier:fonction de l'alerte : sa première fonction, sinon son premier élément."""
    elements = finding.get("elements") or []
    chosen = next((e for e in elements if e.get("type") == "function"), elements[0] if elements else None)
    if chosen is None:
        return "?:?"
    return f"{(chosen.get('source_mapping') or {}).get('filename_relative', '?')}:{chosen.get('name', '?')}"

counts = {}
used = set()
for finding in detectors:
    impact = finding.get("impact", "?")
    counts[impact] = counts.get(impact, 0) + 1
    if impact != "High":
        continue
    key = (finding.get("check", "?"), target_of(finding))
    if key in active:
        used.add(key)
        number, reason, expiry = active[key]
        print(f"dérogation active : {key[0]} sur {key[1]} jusqu'au {expiry} ({reason})")
    else:
        failures.append(f"alerte haute sans dérogation : {key[0]} sur {key[1]}")

for key, (number, _, _) in sorted(active.items(), key=lambda item: item[1][0]):
    if key not in used:
        warn(f"{name}:{number} : dérogation {key[0]} sur {key[1]} sans alerte correspondante, à retirer")

summary = ", ".join(f"{counts[k]} {label}" for k, label in (("High", "haute(s)"), ("Medium", "moyenne(s)"), ("Low", "basse(s)")) if k in counts)
print(f"slither : {summary or 'aucune alerte'} ; moyennes et basses informatives")

if failures:
    for failure in failures:
        print(f"ECHEC {failure}", file=sys.stderr)
    print(f"contrat : {len(failures)} contrôle(s) en échec", file=sys.stderr)
    sys.exit(1)
print("contrat : OK")
PY
