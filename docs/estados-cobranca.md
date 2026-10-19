# Estados da cobrança

Implementação: `packages/shared/src/charge-states.ts`, `order-evaluation.ts`, `packages/core/src/charges/*`.

## Estados

| Estado | Significado | POS |
|---|---|---|
| `CREATING` | Registro criado, Order sendo enviada | reservado |
| `PENDING` | Order criada (`created`), aguardando pagamento | reservado |
| `RECONCILING` | Incerteza ou divergência (falha de comunicação, resposta incoerente, sem terminal após expiração) | **reservado** |
| `PAID` | `processed/accredited` validado integralmente | liberado |
| `EXPIRED` | `expired/expired` confirmado pelo MP | liberado |
| `CANCELLED` | cancelamento remoto confirmado por GET | liberado |
| `FAILED` | MP recusou a criação (4xx definitivo) — Order certamente não existe | liberado |
| `REFUNDED` | estorno (evento distinto, apenas a partir de `PAID`) | — |

## Transições válidas

```
CREATING    -> PENDING | FAILED | RECONCILING
PENDING     -> PAID | EXPIRED | CANCELLED | RECONCILING
RECONCILING -> PENDING | PAID | EXPIRED | CANCELLED | FAILED
EXPIRED     -> PAID        (pagamento atrasado detectado na verificação pós-terminal)
CANCELLED   -> PAID        (idem)
PAID        -> REFUNDED
FAILED, REFUNDED: finais
```

`PAID` é irreversível: além da regra de aplicação, o trigger `charges_guard_paid` no PostgreSQL impede qualquer regressão e alteração de valor/referência/POS/token.

## Regra de aprovação (seção 7)

`PAID` somente se: mesmo `order_id`; `user_id` da conta recebedora; `external_reference` idêntica; `currency=BRL`; `total_amount`, `total_paid_amount`, `amount` e `paid_amount` iguais ao valor da cobrança (tolerância zero); Order e transação `processed/accredited`; `payment_method.id = pix`; `config.qr.external_pos_id` igual ao `external_id` do POS. Qualquer falta → `RECONCILING` (com motivos gravados) ou `PENDING` (se `created`). Erros HTTP/timeout **nunca** produzem `EXPIRED`.

Observação: o exemplo de resposta paga fornecido não mostra `currency`; a regra exige `BRL`. Se a resposta real não trouxer o campo, a cobrança vai para `RECONCILING` com `CURRENCY_MISSING` — validar no teste real e ajustar conscientemente se necessário.

## Concorrência

1. `SELECT ... FOR UPDATE` no POS dentro da transação de criação.
2. Índice parcial único `charges_one_active_per_pos` (`status IN CREATING/PENDING/RECONCILING`).
3. `pos_terminals.active_charge_id` único.
Segunda cobrança → `409 POS_BUSY` com referência e segundos restantes.

## Idempotência

- Cliente → API: header `Idempotency-Key` (único por tenant).
- API → MP: `X-Idempotency-Key = charges.idempotency_key` (UUID). Em resultado incerto, o worker reenvia o **mesmo payload e chave** para recuperar a Order já criada.
- Confirmação: `payments (mp_connection_id, mp_payment_id)` único; transição feita com lock de linha.

## Expiração

`expires_at = created_date + expiration_time` da resposta do MP. O cronômetro do cliente é informativo (corrigido pelo relógio do servidor). Após `expires_at + 2 min` sem estado terminal remoto → `RECONCILING` (POS segue reservado). Verificação pós-terminal 10 min após `EXPIRED/CANCELLED` detecta pagamento atrasado.
