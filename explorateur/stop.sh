#!/usr/bin/env bash
# Arrête l'explorateur VETO : front, API, indexeur, puis MongoDB (arrêt propre, les données restent).
D="$(cd "$(dirname "$0")" && pwd)"
pkill -TERM -f "$D/codenekt-explorer-fronten[d]"
pkill -TERM -f "$D/erol-explorer-backen[d]"
sleep 1
pkill -TERM -f "$D/mongo/node_modules/.cache/mongodb-memory-server/mongo[d]"
echo "Explorateur arrêté."
