#!/usr/bin/env bash
# Lance le binaire gitleaks épinglé (installé dans .tools/bin au premier appel,
# somme de contrôle vérifiée). Même version en local, en pré-commit et en CI.
# Usage : scripts/gitleaks.sh <arguments gitleaks>
set -euo pipefail

GITLEAKS_VERSION="8.30.1"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.tools/bin/gitleaks"

install_gitleaks() {
  local os arch asset sha tmp
  os="$(uname -s)"
  arch="$(uname -m)"
  # Sommes SHA-256 publiées dans gitleaks_8.30.1_checksums.txt (release GitHub).
  case "$os/$arch" in
    Linux/x86_64)
      asset="linux_x64"
      sha="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" ;;
    Linux/aarch64 | Linux/arm64)
      asset="linux_arm64"
      sha="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080" ;;
    Darwin/x86_64)
      asset="darwin_x64"
      sha="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709" ;;
    Darwin/arm64)
      asset="darwin_arm64"
      sha="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5" ;;
    *)
      echo "gitleaks : plateforme non prise en charge ($os/$arch)" >&2
      exit 2 ;;
  esac

  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  local tarball="gitleaks_${GITLEAKS_VERSION}_${asset}.tar.gz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "$tmp/$tarball" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${tarball}"

  local got
  if command -v sha256sum >/dev/null 2>&1; then
    got="$(sha256sum "$tmp/$tarball" | cut -d' ' -f1)"
  else
    got="$(shasum -a 256 "$tmp/$tarball" | cut -d' ' -f1)"
  fi
  if [ "$got" != "$sha" ]; then
    echo "gitleaks : somme de contrôle invalide pour $tarball" >&2
    echo "  attendu : $sha" >&2
    echo "  obtenu  : $got" >&2
    exit 2
  fi

  tar -xzf "$tmp/$tarball" -C "$tmp" gitleaks
  mkdir -p "$(dirname "$BIN")"
  mv "$tmp/gitleaks" "$BIN"
  chmod 0755 "$BIN"
}

if [ ! -x "$BIN" ] || [ "$("$BIN" version 2>/dev/null)" != "$GITLEAKS_VERSION" ]; then
  install_gitleaks >&2
fi

exec "$BIN" "$@"
