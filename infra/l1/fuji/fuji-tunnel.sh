#!/usr/bin/env bash
# Ouvre le RPC privé du validateur Fuji (EC2) sur 127.0.0.1:9670 par tunnel SSH.
systemctl --user is-active --quiet chk-fuji-tunnel && { echo "tunnel déjà ouvert"; exit 0; }
systemd-run --user --unit=chk-fuji-tunnel -p Restart=always -p RestartSec=5 /usr/bin/ssh -i "$HOME/.ssh/chk-fuji-node.pem" -N \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:9670:127.0.0.1:9650 ubuntu@54.198.102.83
echo "RPC: http://127.0.0.1:9670/ext/bc/RkJGt3ZenMaUz64EP1cUZeisftYMb9WaJdvYw54xfvkUccgke/rpc"
