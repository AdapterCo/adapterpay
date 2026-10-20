#!/usr/bin/env bash
# Deploy de um release na VPS. Uso: infra/scripts/deploy.sh [release]
# - Constrói as imagens com tag do release.
# - Executa o job de migração; se falhar, ABORTA sem trocar api/worker/web.
# - Sobe os serviços e verifica saúde; registra o release anterior para rollback.
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/../.."

# Atualiza o código antes do build e reexecuta a versão nova deste script (SKIP_PULL=1 desliga).
if [ -z "${SKIP_PULL:-}" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  echo ">> git pull (origin master)"
  git pull --ff-only origin master
  exec env SKIP_PULL=1 "$SELF" "$@"
fi

RELEASE="${1:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
COMPOSE="docker compose -f docker-compose.prod.yml"
STATE_DIR=".deploy"
mkdir -p "$STATE_DIR"

[ -f .env ] || { echo "ERRO: .env ausente (copie de .env.example e preencha)"; exit 1; }
set -a; . ./.env; set +a
docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1 || { echo "ERRO: rede Traefik '$TRAEFIK_NETWORK' não existe (ver infra/traefik/README.md)"; exit 1; }

PREVIOUS="$(cat "$STATE_DIR/current" 2>/dev/null || echo "")"
echo ">> Release: $RELEASE (anterior: ${PREVIOUS:-nenhum})"

echo ">> Backup preventivo antes da migração"
if $COMPOSE ps postgres --status running -q >/dev/null 2>&1 && [ -n "$($COMPOSE ps postgres --status running -q)" ]; then
  infra/scripts/backup.sh "pre-$RELEASE"
fi

echo ">> Build"
RELEASE="$RELEASE" $COMPOSE build

echo ">> Infra (postgres/redis)"
RELEASE="$RELEASE" $COMPOSE up -d postgres redis

echo ">> Migração (falha aborta o release)"
if ! RELEASE="$RELEASE" $COMPOSE run --rm migrate; then
  echo "ERRO: migração falhou. Release $RELEASE NÃO aplicado. Serviços atuais mantidos."
  exit 1
fi

echo ">> Subindo api, worker e web"
RELEASE="$RELEASE" $COMPOSE up -d --no-deps api worker web

echo ">> Aguardando saúde"
for i in $(seq 1 30); do
  if infra/scripts/healthcheck.sh >/dev/null 2>&1; then
    echo "$PREVIOUS" > "$STATE_DIR/previous"
    echo "$RELEASE" > "$STATE_DIR/current"
    echo ">> Release $RELEASE saudável."
    exit 0
  fi
  sleep 5
done
echo "ERRO: release $RELEASE não ficou saudável. Considere: infra/scripts/rollback.sh"
exit 1
