#!/usr/bin/env bash
# Rollback para o release anterior (imagens já construídas e tagueadas).
# ATENÇÃO: migrations são forward-only. Se o release com problema aplicou migration incompatível,
# restaure o backup "pre-<release>" (infra/scripts/restore.sh) ANTES de subir o release anterior.
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f docker-compose.prod.yml"
TARGET="${1:-$(cat .deploy/previous 2>/dev/null || echo "")}"
[ -n "$TARGET" ] || { echo "ERRO: release anterior desconhecido. Uso: rollback.sh <release>"; exit 1; }
for svc in api worker web; do
  docker image inspect "adapterpay-$svc:$TARGET" >/dev/null 2>&1 || { echo "ERRO: imagem adapterpay-$svc:$TARGET não encontrada"; exit 1; }
done
echo ">> Rollback para $TARGET"
RELEASE="$TARGET" $COMPOSE up -d --no-deps api worker web
for i in $(seq 1 30); do
  if infra/scripts/healthcheck.sh >/dev/null 2>&1; then
    echo "$TARGET" > .deploy/current
    echo ">> Rollback concluído ($TARGET)."
    exit 0
  fi
  sleep 5
done
echo "ERRO: rollback não ficou saudável"; exit 1
