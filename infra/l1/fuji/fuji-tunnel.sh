#!/usr/bin/env bash
# Ouvre le RPC privé du validateur Fuji (EC2) sur 127.0.0.1:9670 par tunnel SSH.
# L'hôte vient de FUJI_HOST, ou à défaut de ~/.config/team19/fuji-host (hors dépôt).
set -euo pipefail

HOST_FILE="$HOME/.config/team19/fuji-host"
host="${FUJI_HOST:-}"
if [ -z "$host" ] && [ -r "$HOST_FILE" ]; then
  host="$(tr -d '[:space:]' < "$HOST_FILE")"
fi
if [ -z "$host" ]; then
  echo "ERREUR : hôte du validateur inconnu. Définissez FUJI_HOST ou écrivez-le dans $HOST_FILE." >&2
  exit 1
fi

systemctl --user is-active --quiet chk-fuji-tunnel && { echo "tunnel déjà ouvert"; exit 0; }
systemd-run --user --unit=chk-fuji-tunnel -p Restart=always -p RestartSec=5 /usr/bin/ssh -i "$HOME/.ssh/chk-fuji-node.pem" -N \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:9670:127.0.0.1:9650 "ubuntu@$host"
echo "RPC: http://127.0.0.1:9670/ext/bc/RkJGt3ZenMaUz64EP1cUZeisftYMb9WaJdvYw54xfvkUccgke/rpc"
