# Integração Mercado Pago

Todo acesso ao provedor está em `packages/core/src/mercado-pago/`. Nenhum token é enviado ao navegador, a logs ou a relatórios.

## Contratos

| Operação | Endpoint | Situação |
|---|---|---|
| Criar Order QR estática | `POST /v1/orders` (`type: qr`, `mode: static`, `expiration_time: PT3M`, `X-Idempotency-Key`) | **Comprovado pelo usuário** |
| Consultar Order | `GET /v1/orders/{id}` | **Comprovado** |
| POS (QR/BR Code) | `GET /v2/pos/{id}` → `qr_response.qr_code` | **Comprovado** |
| Criar POS | `POST /pos` | Rota informada; **corpo a validar** (`name, fixed_amount, store_id, external_store_id, external_id, category`) |
| Buscar POS | `GET /pos?offset&limit` | A validar |
| Atualizar POS (regularizar `external_id`) | `PUT /pos/{id}` | A validar |
| Criar/buscar lojas | `POST /users/{id}/stores`, `GET /users/{id}/stores/search` | A validar |
| Cancelar Order | `POST /v1/orders/{id}/cancel` | A validar — o POS só é liberado após `GET` confirmar `canceled` |
| Tarifa/líquido | `GET /v1/payments/{reference_id}` (`fee_details`, `net_received_amount`) | A validar (premissa: `reference_id` = ID em `/v1/payments`) |
| OAuth | `auth.mercadopago.com/authorization`, `POST /oauth/token`, `GET /users/me` | Documentação pública |
| Assinatura Pix (plataforma) | `POST/GET/PUT /v1/payments` (`payment_method_id: pix`) | Documentação pública; validar na conta da plataforma |
| Assinatura cartão (plataforma) | `POST/GET/PUT /preapproval`, `GET /authorized_payments/search` | **A validar por polling** (ver assinaturas.md) |

Os contratos "a validar" estão isolados em funções pequenas; ajuste apenas `stores-pos.ts`/`payments.ts` após os testes de contrato.

## Teste de contrato (executar antes de produção)

Com uma conta de teste autorizada via OAuth no ambiente de homologação:

1. `POST /stores` com `createRemote: true` → conferir resposta e `mp_store_id` gravado.
2. `POST /pos` → conferir `mp_pos_id`, `external_id`, e que `GET /v2/pos/{id}` traz `qr_response.qr_code` válido (CRC verificado em `validateBrCode`).
3. `POST /pos/import/preview` numa conta com POS pré-existentes → paginação e campos.
4. Cobrança de R$ 1,00 → pagar → `processed/accredited` → `PAID`.
5. Cobrança sem pagamento → `expired/expired` → `EXPIRED`.
6. Cancelamento de Order pendente → verificar resposta e estado final.
7. `GET /v1/payments/{reference_id}` → conferir `fee_details`.

Registre respostas saneadas em `docs/contratos/` (sem tokens) e ajuste os tipos.

## OAuth

- App da Adapter Co. com Client ID/Secret de produção (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`) e Redirect URI exata `https://adapterpay.adapterco.com.br/api/v1/integrations/mercado-pago/callback`.
- `state` aleatório de 256 bits, armazenado como SHA-256 em `oauth_states`, expira em 10 min, uso único e vinculado à sessão que iniciou.
- PKCE: `MP_OAUTH_PKCE=true` somente se habilitado no app MP (precisa coincidir).
- Tokens cifrados (AES-256-GCM); renovação serializada por lock Redis; `invalid_grant` → conexão `NEEDS_RECONNECT` + notificação no painel.
- Uma conta MP (`mp_user_id`) só pode estar ativa em um tenant (índice parcial `mp_connections_one_active_owner`); conflito retorna `account_in_use`.

## Polling e resiliência

- Intervalo inicial `POLL_INTERVAL_SECONDS` (3 s); 10 s após 1 min da expiração; 60 s após 15 min; 15 min após 24 h.
- Lease por Order em `polling_jobs` (um consumidor por vez entre workers).
- Semáforo por conta (`MP_MAX_CONCURRENCY_PER_ACCOUNT`), circuit breaker (10 falhas/60 s → abre 30 s), backoff com jitter e `Retry-After` em 429.
- Sweeper a cada 5 s retoma jobs atrasados (perda de fila, reinício).

## Credenciais separadas

- **Plataforma** (assinaturas): `MP_PLATFORM_CREDENTIALS_REF=file:/run/secrets/mp_platform_access_token`.
- **Lojistas** (vendas): somente via OAuth, por conexão.
