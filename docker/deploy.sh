#!/bin/sh
# Pull the latest topbox-server image and restart — the shell equivalent of Container Manager's
# "Action > Update" on the signoff project.
set -e
cd "$(dirname "$0")"
docker compose pull
docker compose up -d
echo "==> done. Logs: docker compose logs -f topbox-server"
