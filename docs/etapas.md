# Entrega por etapa (seção 19)

Legenda: ✅ implementado e verificado localmente (build/typecheck/testes) · 🟡 implementado, depende de validação externa · ⏳ não verificado.

## Etapa 1 — Fundação
✅ Monorepo pnpm, Prisma + 2 migrations aplicadas em PostgreSQL 17, autenticação (Argon2id, sessão, CSRF, MFA), tenant, RBAC, escopo por loja, auditoria.
🟡 Compose de produção, Traefik por labels, TLS pelo resolver existente — escritos, **não executados** (sem Docker/VPS neste ambiente).

## Etapa 2 — Comercial
✅ Planos (seed), limites com lock transacional (teste concorrente), bloqueio por inadimplência, onboarding, telas de assinatura.
🟡 Pix da plataforma (`/v1/payments`) e cartão (`/preapproval`): código completo; **não testado** com a conta MP da plataforma. Cartão: ver limitação em assinaturas.md.

## Etapa 3 — OAuth + lojas/POS
✅ OAuth com state de uso único, tokens cifrados, renovação, conflitos de conta, desconexão segura; sync de POS via `GET /v2/pos/{id}` com validação de BR Code; QR da URL pública; placa e NFC (NDEF URI).
🟡 Criação/importação de lojas e POS (`POST /pos`, `/users/{id}/stores`, `GET /pos`, `PUT /pos/{id}`): contratos a validar. Se o formato divergir, as chamadas retornam `502 MP_UPSTREAM_ERROR` sem gravar estado inconsistente.

## Etapa 4 — Motor financeiro
✅ Criação de Order (contrato comprovado), polling com lease, reconciliação, concorrência, expiração, máquina de estados, páginas `/p` e `/c`, SSE com fallback — verificados com PostgreSQL real e MP simulado.
⏳ **Pagamento real e expiração real não executados.** Não declarar pronto antes dos testes 5–10 de docs/testes.md.
🟡 Cancelamento manual (`POST /v1/orders/{id}/cancel`): endpoint a validar; se recusado, retorna `409 MP_UNSUPPORTED_OPERATION` e a cobrança segue até expirar.

## Etapa 5 — Operação e relatórios
✅ Dashboard, cobrança rápida, financeiro, relatórios do contador, exportação CSV/XLSX, auditoria, superadmin (tenants, bloqueio justificado, planos, faturas, saúde, falhas OAuth), métricas, health, backup/restore/rollback scripts.
⏳ E2E de navegador, testes em dispositivos, restauração real de backup.

## Endpoints que podem retornar erro por dependência externa
| Endpoint | Condição |
|---|---|
| `POST /stores` (`createRemote`), `POST /pos`, `POST /pos/import/*`, `POST /stores/import/*`, `POST /pos/:id/regularize` | contrato MP divergente → 502 |
| `POST /charges/:id/cancel` | cancelamento não suportado → 409 `MP_UNSUPPORTED_OPERATION` |
| `POST /subscriptions/checkout` (CARD), `POST /subscriptions/card/refresh` | preapproval não validado |
| Todos que usam MP | conta revogada → 409 `MP_RECONNECT_REQUIRED`; indisponibilidade → 502/503 |

Nenhum endpoint retorna 501; não há rotas "TODO".

## Pendências técnicas (seção 20)
1. Contratos de lojas/POS em contas de terceiros. 2. Polling suficiente para cartão recorrente. 3. Tarifas por conta (taxa zero não é universal). 4. Rate limits de Orders em escala. 5. Cancelamento remoto e Order incerta.
Além disso: confirmar presença de `currency` na resposta paga da Order (a regra exige `BRL`) e que `reference_id` corresponde ao ID de `/v1/payments`.
