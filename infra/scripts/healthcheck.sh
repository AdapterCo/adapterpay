#!/usr/bin/env bash
# Verifica a aplicação pelo domínio público (TLS + Traefik + API + web).
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${APP_HOST:-$(grep -E '^APP_HOST=' .env | cut -d= -f2)}"
curl -fsS --max-time 10 "https://$HOST/api/v1/health/ready" | grep -q '"status":"ok"'
curl -fsS --max-time 10 -o /dev/null "https://$HOST/"
echo "OK https://$HOST"
