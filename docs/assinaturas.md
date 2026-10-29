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

## Indicação de lojistas

- Cada lojista tem um código de 8 caracteres e o link `/cadastro?ref=CÓDIGO` (painel › Indicações).
- **Quem se cadastra com o código** recebe R$ 10,00 de crédito **uma única vez**, abatido na primeira mensalidade. O código só pode ser informado no cadastro, não vale para o próprio CPF/CNPJ e não vale de novo para um CPF/CNPJ que já usou indicação (mesmo em outra conta).
- **Quem indicou** recebe R$ 10,00 de crédito por indicado, quando o indicado paga a primeira mensalidade (`billing_credits` com unicidade por tipo e indicado: o bônus nunca se repete).
- Créditos: saldo em `tenants.billing_credit_cents`, extrato em `billing_credits`. Ao emitir uma fatura Pix, o desconto fica reservado nela (`invoices.credit_applied_cents`, `amount_cents` já líquido) e só sai do saldo quando ela é paga; fatura anulada libera a reserva. A fatura nunca fica abaixo de R$ 1,00; o restante do crédito vale nos meses seguintes.
- Cartão: o crédito reduz o valor recorrente do `preapproval` para a próxima cobrança (`subscriptions.card_credit_cents`); a cobrança reduzida é reconhecida pelo polling e, depois dela, o valor volta ao normal.

### Parceiros de indicação (sem conta)

- Qualquer pessoa se cadastra em `/indique` com nome, WhatsApp e chave Pix (chave criptografada) e recebe um link/código no mesmo formato dos lojistas.
- O painel do parceiro fica em `/indique/painel/<token>` (link secreto; só o hash do token é guardado). Mostra cadastros feitos com o link, quantos pagaram, valor a receber e pagamentos já feitos; os nomes das empresas aparecem abreviados.
- WhatsApp já cadastrado em `/indique`: um link novo do painel é enviado ao próprio WhatsApp (instância da plataforma) e só então o anterior deixa de valer.
- O indicado ganha o mesmo desconto de R$ 10,00 uma única vez. A comissão de R$ 10,00 passa a "a receber" quando o indicado paga a primeira mensalidade (`partner_referrals`: REGISTERED → EARNED → PAID_OUT).
- Pagamento: superadmin › Parceiros mostra a chave Pix e o valor; a equipe faz o Pix pelo banco e clica em "Registrar Pix" (quita as indicações a receber, audita e avisa o parceiro por WhatsApp). "Bloquear" faz o código deixar de valer em novos cadastros.
