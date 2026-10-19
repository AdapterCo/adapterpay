#!/usr/bin/env bash
# Backup criptografado do PostgreSQL (pg_dump formato custom + GPG).
# Uso: infra/scripts/backup.sh [rótulo]    Cron sugerido: 0 */6 * * * /opt/adapterpay/infra/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
: "${BACKUP_GPG_RECIPIENT:?defina BACKUP_GPG_RECIPIENT no .env}"
LABEL="${1:-auto}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="backups"
mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/adapterpay-$STAMP-$LABEL.dump.gpg"

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges \
  | gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$OUT"

[ -s "$OUT" ] || { echo "ERRO: backup vazio"; rm -f "$OUT"; exit 1; }
sha256sum "$OUT" > "$OUT.sha256"
echo ">> Backup: $OUT ($(du -h "$OUT" | cut -f1))"

# Retenção local: 30 dias (copie para armazenamento externo — ver docs/operacao.md).
find "$DIR" -name 'adapterpay-*.dump.gpg*' -mtime +30 -delete
