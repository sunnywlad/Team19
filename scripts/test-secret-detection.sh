#!/usr/bin/env bash
# Prouve que la détection de secrets fonctionne avec .gitleaks.toml.
# Le faux secret est construit à l'exécution (concaténation + dérivation) :
# il n'apparaît jamais en clair dans le dépôt.
# Sortie : 0 si tous les cas se comportent comme attendu, 1 sinon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/.gitleaks.toml"
GITLEAKS="$ROOT/scripts/gitleaks.sh"
# Code de sortie dédié aux fuites, pour ne pas confondre « secret détecté »
# avec une erreur de gitleaks ou de configuration (qui sortent en 1).
LEAK=42

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Jeton au format d'un PAT GitHub : préfixe assemblé + 36 caractères dérivés.
prefix="gh"
prefix="${prefix}p_"
body="$(printf '%s' 'argent-intelligent-canari' | sha256sum | cut -c1-36)"
fake="${prefix}${body}"

failures=0

# scan <nom du cas> <code attendu> <fichier> <contenu>
# Committe le contenu dans un dépôt neuf puis scanne tout son historique,
# comme le fait la CI.
scan() {
  local name="$1" expected="$2" file="$3" content="$4"
  local repo="$WORK/$name" got=0
  mkdir -p "$repo"
  git -C "$repo" init --quiet
  printf '%s\n' "$content" > "$repo/$file"
  git -C "$repo" add -- "$file"
  git -C "$repo" -c user.name=test -c user.email=test@invalid \
    -c commit.gpgsign=false -c core.hooksPath=/dev/null \
    commit --quiet --no-verify -m "cas $name"

  "$GITLEAKS" git --config "$CONFIG" --exit-code "$LEAK" --redact --no-banner \
    --log-level error "$repo" >/dev/null 2>&1 || got=$?

  if [ "$got" -eq "$expected" ]; then
    echo "OK    $name"
  else
    echo "ECHEC $name (code $got, attendu $expected)"
    failures=$((failures + 1))
  fi
}

# 1. Un secret dans un fichier quelconque est détecté.
scan "secret-dans-le-code" "$LEAK" "config.txt" "token = \"$fake\""
# 2. L'allowlist n'exempte pas .env.example : une valeur renseignée est détectée.
scan "secret-dans-env-example" "$LEAK" ".env.example" "GITHUB_TOKEN=$fake"
# 3. Témoin négatif : un .env.example aux valeurs vides ne déclenche rien.
scan "env-example-vide" 0 ".env.example" "GITHUB_TOKEN="

if [ "$failures" -ne 0 ]; then
  echo "Détection de secrets : $failures cas en échec" >&2
  exit 1
fi
echo "Détection de secrets : fonctionnelle"
