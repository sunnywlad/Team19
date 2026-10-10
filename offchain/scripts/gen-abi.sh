#!/usr/bin/env bash
# Génère abi/market.ts depuis ../out/IVerificationMarket.sol/IVerificationMarket.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_JSON="$REPO_ROOT/out/IVerificationMarket.sol/IVerificationMarket.json"
ABI_DIR="$SCRIPT_DIR/../abi"

if [ ! -f "$OUT_JSON" ]; then
  echo "ERROR: $OUT_JSON not found. Run 'forge build' first." >&2
  exit 1
fi

mkdir -p "$ABI_DIR"

ABI=$(python3 -c "
import json, sys
with open('$OUT_JSON') as f:
    d = json.load(f)
print(json.dumps(d['abi'], indent=2))
")

cat > "$ABI_DIR/market.ts" << 'TSEOF'
// AUTO-GENERATED — do not edit by hand
// Source: out/IVerificationMarket.sol/IVerificationMarket.json
// Run scripts/gen-abi.sh to regenerate
TSEOF

echo "export const marketAbi = $ABI as const;" >> "$ABI_DIR/market.ts"

echo "Generated abi/market.ts"
