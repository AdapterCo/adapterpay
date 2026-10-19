# Assinaturas da plataforma

Implementação: `packages/core/src/billing/billing-service.ts`. Cobrança na conta MP da **Adapter Co.**, separada das vendas dos lojistas. Sem webhooks: tudo por polling.

## Políticas
- **Sem teste grátis.** Cadastro cria tenant `PENDING_ACTIVATION` e assinatura `PENDING`; uso operacional só após pagamento confirmado no backend.
- **Pix manual por competência.** Fatura `RENEWAL` emitida `BILLING_RENEWAL_LEAD_DAYS` (5) dias antes de `current_period_end`; o Pix é gerado sob demanda (validade ≤ 24 h) e o anterior é cancelado no MP antes de gerar outro.
- **Vencimento**: instante exato `current_period_end` (UTC), exibido em `America/Sao_Paulo`.
- **Tolerância zero**: ao vencer, o worker consulta o pagamento uma última vez; sem pagamento → assinatura `PAST_DUE`, tenant `SUSPENDED` (bloqueia novas Orders e ativação/criação de POS, lojas e usuários; mantém login, histórico, faturas, OAuth e conciliação).
- **Reativação**: pagamento confirmado → novo período começa na data da confirmação. Pagamento antecipado mantém o ciclo contínuo.
- **Upgrade**: cobrança complementar Pix = diferença × segundos restantes / segundos do período, arredondada para cima ao centavo; plano muda após confirmação; em assinatura de cartão, o valor recorrente é atualizado em seguida. Fatura de upgrade não paga em 3 dias é anulada (não suspende).
- **Downgrade**: agendado para o próximo ciclo; recusado se o uso exceder o plano alvo; reavaliado na emissão da renovação.
- **Cancelamento**: sem renovação (preapproval cancelado no MP); acesso até o fim do período pago; depois `CANCELED`; histórico preservado.

## Cartão recorrente — limitação a validar (seção 20, item 2)

Usa o checkout oficial `preapproval` (`init_point`), sem PAN/CVV no AdapterPay. A confirmação de pagamentos de renovação depende de `GET /authorized_payments/search?preapproval_id=` retornar `status=processed` e `payment.status=approved`. **Não foi comprovado** que esse endpoint reflita todas as renovações, falhas e retentativas sem webhook. Até essa validação, **não se deve afirmar automação integral do cartão**: o painel do superadmin mostra `preapproval_status` e faturas para acompanhamento, e a suspensão por período vencido continua ativa.
