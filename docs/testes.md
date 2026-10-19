# Testes

## Automatizados

| Suite | Comando | Cobertura |
|---|---|---|
| `packages/shared` | `pnpm --filter @adapterpay/shared test` | centavos ↔ decimal, regra de aprovação (created, processed/accredited, expired, divergências de valor/Order/POS/conta/moeda/método, respostas incompletas), máquina de estados, limites dos 4 planos, prorrata, RBAC, schemas, BR Code/CRC |
| `packages/core` | `pnpm --filter @adapterpay/core test` | criptografia e rotação, TOTP (vetor RFC), payload exato da Order, cliente HTTP (429/timeout/4xx/redação), cadência de polling, backoff, períodos, config de produção |
| `apps/api` (unit) | `pnpm --filter @adapterpay/api test` | mapeamento de erros (409 POS_BUSY, 422, 403, 503/Retry-After, 500 sem vazamento), CSV injection |
| `apps/api` (integração) | `TEST_DATABASE_URL=... pnpm test:integration` | PostgreSQL real com migrations: corrida no mesmo POS (1 Order, 409), Idempotency-Key, PAID único e irreversível (inclusive trigger), expiração e verificação pós-terminal, timeout ≠ EXPIRED, recuperação de criação incerta pela mesma chave, valor divergente, cross-tenant, vendedor restrito, inadimplência bloqueia, limites concorrentes, tarifa null quando ausente |

Resultado na última execução local (18/10/2026): shared 63 ✓, core 17 ✓, api unit 7 ✓, api integração 13 ✓ (PostgreSQL 17), typecheck de todos os pacotes ✓, `next build` ✓.

**Não executado localmente**: worker e API rodando contra Redis real (BullMQ/SSE), build das imagens Docker, testes E2E de navegador.

## Testes reais obrigatórios (seção 17) — pendentes

Nenhum destes foi executado; dependem de VPS, domínio, contas Mercado Pago reais e dispositivos.

| # | Teste | Status |
|---|---|---|
| 1 | Registrar tenant e contratar plano real; ativação só após pagamento | ⏳ |
| 2 | OAuth de conta MP lojista; persistência e renovação | ⏳ |
| 3 | Criar loja e POS remoto; QR e placa | ⏳ (contrato a validar) |
| 4 | Importar loja/POS existentes sem duplicação e com limites | ⏳ |
| 5 | Order de R$ 1,00 `PT3M` | ⏳ |
| 6 | `/p/:slug`, copiar `qr_code`, pagar, confirmar por polling | ⏳ |
| 7 | `/c/:token` representa apenas a Order original | ⏳ |
| 8 | Expiração `expired/expired`, POS liberado | ⏳ |
| 9 | Duas cobranças simultâneas no mesmo POS | ⏳ (coberto em integração) |
| 10 | Reiniciar API/worker durante pagamento | ⏳ |
| 11 | Dois tenants com contas MP distintas | ⏳ |
| 12 | Vendedor, contador e superadmin com auditoria | ⏳ |
| 13 | Limites dos quatro planos | ⏳ |
| 14 | Vencimento sem tolerância e reativação | ⏳ |
| 15 | Assinatura Pix manual e cartão recorrente (renovação e falha) | ⏳ |
| 16 | Tarifas reais e líquido | ⏳ |
| 17 | QR/NFC em Android/iOS, desktop/tablet, acessibilidade, rede lenta | ⏳ |

Registre evidências (data, conta, Order ID, prints sem dados sensíveis) em `docs/evidencias/`.
