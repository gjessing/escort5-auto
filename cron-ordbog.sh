#!/bin/bash
# cron-ordbog.sh — koerer 1 ordbogs-opslag ad gangen, sikkert fra cron
# Brug i crontab:
#   */30 * * * * /home/hjemme/escort5-auto/cron-ordbog.sh >> /home/hjemme/escort5-auto/cron-ordbog.log 2>&1
#
# Wrapperen sikrer:
#   - Korrekt arbejdsmappe (cron starter i $HOME med tom env)
#   - File-lock saa to koersler ikke overlapper
#   - Datostempel i loggen
#   - Komplet output gemmes til log-fil

set -u

# === KONFIGURATION ===
PROJEKT_DIR="/home/hjemme/escort5-auto"
NODE_BIN="$(command -v node 2>/dev/null || echo /usr/bin/node)"
SCRIPT="ret-gamle.js"
TYPE="ordbog"
MAX=1
LOCK_FIL="/tmp/escort5-${TYPE}.lock"

# === PRE-FLIGHT TJEK ===
cd "$PROJEKT_DIR" || { echo "$(date '+%F %T') FEJL: kunne ikke cd til $PROJEKT_DIR"; exit 1; }

if [ ! -x "$NODE_BIN" ]; then
  echo "$(date '+%F %T') FEJL: node ikke fundet ($NODE_BIN). Sæt NODE_BIN i scriptet."
  exit 1
fi

if [ ! -f "$SCRIPT" ]; then
  echo "$(date '+%F %T') FEJL: $SCRIPT findes ikke i $PROJEKT_DIR"
  exit 1
fi

# === FILE-LOCK (forhindrer overlap hvis en koersel tager laenge) ===
exec 9>"$LOCK_FIL"
if ! flock -n 9; then
  echo "$(date '+%F %T') Springer over: en koersel laeser allerede ($LOCK_FIL)"
  exit 0
fi

# === KOERSEL ===
echo ""
echo "================================================"
echo "  $(date '+%F %T') Cron-ordbog starter"
echo "================================================"

"$NODE_BIN" "$SCRIPT" --type "$TYPE" --max "$MAX" --headless
EXIT_KODE=$?

echo "$(date '+%F %T') Faerdig (exit kode: $EXIT_KODE)"
exit $EXIT_KODE
