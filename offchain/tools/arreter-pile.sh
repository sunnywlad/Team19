#!/usr/bin/env bash
# arreter-pile.sh — arrête la pile lancée par E2E_SERVE=1 bash offchain/e2e.sh
PIDFILE="${E2E_LOG_DIR:-$HOME/code/sunnywlad/Team19-notes/logs/pile-aws}/pile.pid"
if [ ! -f "$PIDFILE" ]; then echo "[arret] pas de pile permanente (pas de $PIDFILE)"; exit 0; fi
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then kill -TERM "$PID"; echo "[arret] SIGTERM envoyé à $PID"; else echo "[arret] PID $PID déjà mort"; fi
rm -f "$PIDFILE"
