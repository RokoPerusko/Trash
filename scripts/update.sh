#!/bin/sh
# Ponovno gradi sliku s najnovijom osnovnom slikom (Node/Caddy zakrpe), provjerava ranjivosti
# i ponovno pokrece. Koristenje: scripts/update.sh        (SKIP_SCAN=1 preskace skeniranje)
set -eu
cd "$(dirname "$0")/.."

docker compose pull caddy
docker compose build --pull app

if [ "${SKIP_SCAN:-0}" != "1" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  docker save tak-karta -o "$TMP/image.tar"
  echo "Skeniranje ranjivosti (HIGH i CRITICAL)..."
  docker run --rm -v "$TMP":/scan:ro aquasec/trivy:latest image \
    --input /scan/image.tar --severity HIGH,CRITICAL --ignore-unfixed --exit-code 0
fi

docker compose up -d
docker image prune -f
