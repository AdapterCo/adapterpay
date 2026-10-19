#!/usr/bin/env bash
# Backup do PostgreSQL (pg_dump formato custom).
# - Com BACKUP_GPG_RECIPIENT válido (chave pública importada): arquivo .dump.gpg criptografado.
# - Sem chave GPG: arquivo .dump sem criptografia, com permissão 600 (somente root).
# Uso: infra/scripts/backup.sh [rótulo]    Cron sugerido: 0 */6 * * * /root/adapterpay/infra/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
umask 077
LABEL="${1:-auto}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="backups"
mkdir -p "$DIR"
chmod 700 "$DIR"

dump() {
  docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges
}

RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
if [ -n "$RECIPIENT" ] && [ "$RECIPIENT" != "CHANGE_ME" ] && gpg --list-keys "$RECIPIENT" >/dev/null 2>&1; then
  OUT="$DIR/adapterpay-$STAMP-$LABEL.dump.gpg"
  dump | gpg --batch --yes --trust-model always --encrypt --recipient "$RECIPIENT" --output "$OUT"
else
  OUT="$DIR/adapterpay-$STAMP-$LABEL.dump"
  [ -n "$RECIPIENT" ] && echo "AVISO: chave GPG '$RECIPIENT' não encontrada; backup salvo SEM criptografia (permissão 600)."
  dump > "$OUT"
fi
chmod 600 "$OUT"

[ -s "$OUT" ] || { echo "ERRO: backup vazio"; rm -f "$OUT"; exit 1; }
sha256sum "$OUT" > "$OUT.sha256"
echo ">> Backup: $OUT ($(du -h "$OUT" | cut -f1))"

# Retenção local: 30 dias (copie para armazenamento externo — ver docs/operacao.md).
find "$DIR" -name 'adapterpay-*.dump*' -mtime +30 -delete
