#!/usr/bin/env bash
# Restaura um backup criptografado NO BANCO DE PRODUÇÃO. Operação destrutiva.
# Uso: infra/scripts/restore.sh backups/adapterpay-<stamp>.dump[.gpg] --confirm
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${1:?informe o arquivo .dump ou .dump.gpg}"
[ "${2:-}" = "--confirm" ] || { echo "Operação destrutiva. Repita com --confirm."; exit 1; }
set -a; . ./.env; set +a
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi

echo ">> Parando api/worker/web para evitar escrita durante a restauração"
$COMPOSE stop api worker web

echo ">> Restaurando $FILE"
read_backup() { case "$FILE" in *.gpg) gpg --batch --decrypt "$FILE" ;; *) cat "$FILE" ;; esac; }
read_backup | $COMPOSE exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --exit-on-error

echo ">> Subindo serviços"
$COMPOSE up -d api worker web
echo ">> Restauração concluída. O worker retoma a conciliação de cobranças pendentes automaticamente."
