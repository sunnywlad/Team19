#!/usr/bin/env bash
# Fonctions communes aux scripts. À charger avec « . scripts/lib.sh ».
# Tout scripts/ doit rester compatible bash 3.2 (celui de macOS) : pas de
# mapfile, pas de tableaux associatifs, pas de ${var,,}, et un tableau
# éventuellement vide s'écrit ${t[@]+"${t[@]}"} sous « set -u ».

# sha256 [fichier] : affiche l'empreinte SHA-256 du fichier, ou de l'entrée
# standard. sha256sum sous Linux, shasum (fourni avec macOS) sinon.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@" | cut -d' ' -f1
  else
    echo "sha256 : ni sha256sum ni shasum disponible" >&2
    return 127
  fi
}
