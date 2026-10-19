# Operação (VPS Debian 13 + Traefik existente)

## Primeira instalação

```bash
sudo mkdir -p /opt/adapterpay && sudo chown $USER /opt/adapterpay
git clone <repo> /opt/adapterpay && cd /opt/adapterpay
cp .env.example .env && chmod 600 .env     # preencha TODOS os CHANGE_ME (inclusive MP_PLATFORM_ACCESS_TOKEN)
# Inspecione rede/entrypoint/certresolver do Traefik: infra/traefik/README.md
infra/scripts/deploy.sh
docker compose -f docker-compose.prod.yml run --rm --entrypoint node api dist/cli/create-superadmin.js ops@adapterco.com.br "Operação Adapter Co"
```

Gerar segredos: `openssl rand -base64 32` (ENCRYPTION_KEY), `openssl rand -base64 48` (SESSION_SECRET).

## Comandos

| Ação | Comando |
|---|---|
| Build | `docker compose -f docker-compose.prod.yml build` |
| Migrar | `docker compose -f docker-compose.prod.yml run --rm migrate` |
| Subir | `docker compose -f docker-compose.prod.yml up -d` |
| Deploy completo | `infra/scripts/deploy.sh [release]` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail=200 api worker` |
| Saúde | `infra/scripts/healthcheck.sh` · `/api/v1/health/ready` · superadmin › Operação |
| Backup | `infra/scripts/backup.sh` (cron a cada 6 h) |
| Teste de restauração | `infra/scripts/restore-test.sh` (cron semanal) |
| Restaurar | `infra/scripts/restore.sh backups/<arquivo>.dump.gpg --confirm` |
| Rollback | `infra/scripts/rollback.sh [release]` |
| Escalar worker | `docker compose -f docker-compose.prod.yml up -d --scale worker=2` |

Migração com falha encerra o job com erro: `deploy.sh` aborta antes de trocar api/worker/web. Migrations são forward-only; rollback de schema = restaurar o backup `pre-<release>` gerado pelo deploy.

Copie `backups/` para armazenamento externo (ex.: `rclone copy backups remote:adapterpay-backups`), mantendo a chave GPG privada fora da VPS.

## Observabilidade e alertas

- Logs JSON com `correlation_id` (header `X-Request-Id`).
- `/api/v1/metrics` (Prometheus, bearer `METRICS_TOKEN`): `adapterpay_worker_heartbeat_age_seconds`, `adapterpay_polling_backlog`, `adapterpay_charges_active{status}`.
- Alertas recomendados: heartbeat > 60 s (worker inoperante); backlog > 0 por 2 min; `charges_active{status="RECONCILING"}` > 0 por 10 min; `/health/ready` ≠ 200.
- Superadmin › Operação mostra os mesmos sinais e permite reconsultar uma cobrança.

## Runbooks

- **Worker parado**: `docker compose … logs worker`; reinicie. Ao subir, o sweeper retoma todas as cobranças pendentes; nada é confirmado sem consultar o MP.
- **Cobrança em RECONCILING**: verifique o motivo no detalhe; use "Reconsultar". Não altere estado manualmente no banco.
- **Conta MP revogada**: lojista recebe notificação e reconecta em Mercado Pago › Reconectar (mesma conta mantém POS e cobranças).
- **Fatura vencida contestada**: o sistema consulta o provedor antes de suspender; pagamento confirmado reativa automaticamente.
