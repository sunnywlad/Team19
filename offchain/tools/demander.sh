#!/usr/bin/env bash
# demander.sh — enveloppe de demander.mjs : bash offchain/tools/demander.sh "<prompt>"
exec node "$(dirname "${BASH_SOURCE[0]}")/demander.mjs" "$@"
