#!/usr/bin/env bash
# TESTE REAL de restauração: restaura o backup mais recente num Postgres temporário (container
# descartável, sem rede) e valida contagens básicas. Não toca no banco de produção.
# Uso: infra/scripts/restore-test.sh [arquivo.dump|.dump.gpg]   Cron sugerido: semanal.
set -euo pipefail
cd "$(dirname "$0")/../.."
# "|| true": sem .gpg (ou sem .dump) o ls falha e, com pipefail, o script sairia em silêncio.
FILE="${1:-$(ls -1t backups/adapterpay-*.dump backups/adapterpay-*.dump.gpg 2>/dev/null | head -n1 || true)}"
[ -n "$FILE" ] || { echo "ERRO: nenhum backup encontrado"; exit 1; }
NAME="adapterpay-restore-test-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=test -e POSTGRES_DB=restore postgres:17-bookworm >/dev/null
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

read_backup() { case "$FILE" in *.gpg) gpg --batch --decrypt "$FILE" ;; *) cat "$FILE" ;; esac; }
read_backup | docker exec -i "$NAME" pg_restore -U postgres -d restore --no-owner --no-privileges --exit-on-error

docker exec "$NAME" psql -U postgres -d restore -v ON_ERROR_STOP=1 -At -c "
  SELECT 'tenants=' || count(*) FROM tenants;
  SELECT 'charges=' || count(*) FROM charges;
  SELECT 'payments=' || count(*) FROM payments;
  SELECT 'migrations=' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
  SELECT 'partial_index=' || count(*) FROM pg_indexes WHERE indexname = 'charges_one_active_per_pos';
"
echo ">> Restauração de teste OK: $FILE"
