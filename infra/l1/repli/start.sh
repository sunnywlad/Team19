#!/usr/bin/env bash
# Démarre le repli local VETO (réseau 1919) : nœud A = validateur primaire + validateur L1 (validatorOnly),
# nœud C = observateur non validateur, utile seulement pour le test de synchronisation.
set -euo pipefail
R="${CHK_REPLI_DIR:-$HOME/phaseF/repli}"; BIN="${AVALANCHEGO:-$HOME/phaseF/bin/avalanchego-v1.15.1/avalanchego}"
systemctl --user is-active --quiet chk-repli-A || systemd-run --user --unit=chk-repli-A -p MemoryMax=1200M "$BIN" --config-file="$R/nodeA/node.json"
if [ "${1:-}" = "--with-observer" ]; then
  systemctl --user is-active --quiet chk-repli-C || systemd-run --user --unit=chk-repli-C -p MemoryMax=1000M "$BIN" --config-file="$R/nodeC/node.json"
fi
echo "RPC: http://127.0.0.1:9680/ext/bc/2rR9D9Z7GnUPWcTxmyJnxr96Y3uyeWH46m6V17X5eq7wpiiYLk/rpc"
