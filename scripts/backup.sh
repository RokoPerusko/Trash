#!/bin/sh
# Sigurnosna kopija zona, ruta i zapisnika (Docker volumen tak-data) u backups/.
# Koristenje: scripts/backup.sh        (cuva zadnjih 14 kopija; KEEP=30 scripts/backup.sh)
# Vracanje:   docker run --rm -v <volumen>:/data -v "$PWD/backups":/b alpine \
#               tar xzf /b/<datoteka>.tar.gz -C /data
set -eu
cd "$(dirname "$0")/.."

KEEP="${KEEP:-14}"
VOLUME="$(docker volume ls -q | grep -E '(^|_)tak-data$' | head -n 1 || true)"
if [ -z "$VOLUME" ]; then
  echo "Volumen tak-data nije pronaden (je li aplikacija ikad pokrenuta?)" >&2
  exit 1
fi

umask 077
mkdir -p backups
FILE="tak-data-$(date +%Y%m%d-%H%M%S).tar.gz"
docker run --rm -v "$VOLUME":/data:ro -v "$PWD/backups":/backup alpine \
  tar czf "/backup/$FILE" -C /data .
echo "Spremljeno: backups/$FILE"

# brisanje starijih od zadnjih $KEEP
ls -1t backups/tak-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done
