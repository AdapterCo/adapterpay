# AdapterPay — Instruções completas de desenvolvimento

> **Nome:** AdapterPay  
> **Slogan:** Seu negócio recebe. Você acompanha.  
> **Assinatura de marca:** Uma plataforma da Adapter Co.  
> **Domínio de produção:** https://adapterpay.adapterco.com.br  
> **Status:** Especificação de implementação, incluindo critérios de aceite e dependências a validar na conta Mercado Pago de cada lojista.  
> **Objetivo:** Construir o sistema funcional de ponta a ponta. Não apresentar telas demonstrativas, mocks ou endpoints parciais como se o fluxo financeiro estivesse concluído.

## 1. Objetivo e escopo

Construir um SaaS multiempresa de pagamentos presenciais via Mercado Pago, com QR Code fixo por POS, NFC apontando para página pública e links individuais de cobrança. O **vendedor define o valor**; o cliente apenas visualiza e copia o Pix ou lê o QR Pix apresentado na página. O cliente final não precisa se cadastrar nem instalar o AdapterPay.

O dinheiro é recebido **diretamente na conta Mercado Pago autorizada do lojista**. AdapterPay não realiza custódia, não altera destinatário e não cobra comissão própria por transação. O lojista paga assinatura mensal pela capacidade contratada (POS, lojas e usuários). O backend é a autoridade para criação e confirmação de cobranças.

### Decisões fechadas

- Marca: AdapterPay; slogan e assinatura acima; domínio único `adapterpay.adapterco.com.br`.
- Integração Mercado Pago dos lojistas: **OAuth**; tokens nunca inseridos pelo cliente no navegador como configuração manual.
- Multiempresa, múltiplas lojas por empresa e diferentes contas Mercado Pago por loja, quando compatíveis; uma conta MP pode atender várias lojas se a integração permitir.
- POS: **criar novos estabelecimentos/POS no Mercado Pago** e **importar/sincronizar estabelecimentos/POS existentes**. A interface deve oferecer ambas as opções.
- Cobrança gerada somente por admin/vendedor autorizado, com valor fixado no backend.
- **Order QR estática** comprovada pelo usuário, `expiration_time: "PT3M"`.
- Confirmação financeira: **polling no backend** por Order ID; **não usar webhook de pagamento**.
- Notificações: exclusivamente no painel; **não implementar WhatsApp**.
- Página pública fixa por POS e página individual por cobrança.
- Assinaturas: Pix manual por ciclo e cartão recorrente, por integração apropriada da conta MP da plataforma; zero dias de teste grátis.
- Inadimplência: tolerância zero, bloqueio de novas cobranças a partir do vencimento não quitado, sem interromper conciliação/histórico.
- Taxa zero nas transações Pix foi **observada pelo usuário nos testes da própria conta/modalidade**; não prometer tarifa zero universalmente. Persistir tarifa efetiva e líquido quando disponibilizados.

## 2. Planos e regras comerciais

| Plano | Mensalidade | POS ativos | Lojas ativas | Usuários ativos |
|---|---:|---:|---:|---:|
| Inicial | R$ 29,90 | 1 | 1 | 2 |
| Essencial | R$ 59,90 | 3 | 3 | 5 |
| Profissional | R$ 99,90 | 10 | 10 | 15 |
| Empresarial | R$ 179,90 | 25 | 25 | 40 |

- Limites agregados por **empresa/tenant**, não por loja; administrador proprietário conta no limite de usuários; superadmin interno não conta.
- Cadastro gratuito, **sem uso operacional até pagamento e ativação do plano**; sem teste grátis.
- Contratação: selecionar plano, cadastrar empresa/administrador, validar email, criar assinatura pendente, escolher Pix manual ou cartão recorrente, confirmar pagamento no backend e liberar acesso.
- Pix de assinatura é **manual a cada competência**, com fatura e QR/copia-e-cola próprios do recebedor Adapter Co. Não afirmar recorrência automática no Pix.
- Cartão: usar produto oficial de assinaturas/checkout tokenizado disponível na conta da plataforma; não coletar PAN/CVV em backend ou logs.
- **Sem webhooks financeiros**: reconciliar também pagamentos das assinaturas por polling com identificadores do provedor e política de backoff. Para cartão recorrente, validar quais endpoints e estados permitem consultar renovação, falhas e cancelamento; se o produto exigir webhook para algum evento, registrar essa limitação e não alegar automação integral até resolvê-la.
- Suspensão imediata quando a fatura vencer e permanecer não paga, com verificação prévia de pagamento para evitar bloqueio por atraso de polling. Fuso e instante de vencimento explicitamente definidos.
- Suspenso: bloquear **novas Orders** e criação/ativação de POS, mas manter login administrativo de leitura, histórico, faturas, OAuth/reconexão necessária e conciliação de Orders anteriores.
- Upgrade: após confirmação da cobrança complementar/regra de prorrata escolhida; documentar política de prorrata antes de habilitar cobrança automática.
- Downgrade: agendar para próximo ciclo, exigir desativação de POS/lojas/usuários excedentes; não excluir registros históricos.
- Cancelamento: bloquear renovação, permitir uso até fim do período já pago (salvo regras legais/contratuais); preservar histórico.
- Aplicar limites com transações e bloqueios no backend, evitando excedentes por requisições simultâneas. Incluir tela de uso de limites e avisos.

## 3. Arquitetura recomendada

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS + biblioteca de componentes acessíveis. Responsivo e mobile-first, idioma pt-BR.
- **Backend:** NestJS + TypeScript, API REST versionada `/api/v1`, validação rigorosa, OpenAPI/Swagger protegido.
- **Banco:** PostgreSQL 17 + Prisma migrations. Valores monetários em **centavos inteiros** ou Decimal estrito nos limites da API; nunca `float` para cálculos.
- **Fila e cache:** Redis + BullMQ para polling, reconciliação, expiração e cobrança de assinaturas.
- **Tempo real:** SSE autenticado para painel e página pública com canais isolados; fallback polling do **nosso backend**. Não expor Access Token MP ao frontend.
- **Deploy:** Docker Compose em VPS Debian 13, Traefik já existente, HTTPS/TLS e volumes persistentes. Não publicar Postgres/Redis/API diretamente na internet. Não depender do EasyPanel para gerenciar a aplicação.
- **Workers:** processo separado e escalável, sem depender de navegadores abertos; líder/locks por Order para impedir polling duplicado.
- **Observabilidade:** logs estruturados com correlation_id, métricas, health/readiness, auditoria, backups testados e alertas para worker inoperante/Orders sem conciliação.

### Estrutura sugerida do monorepo

```text
adapterpay/
├── apps/
│   ├── web/                 # Next.js
│   ├── api/                 # NestJS HTTP/SSE
│   └── worker/              # BullMQ jobs
├── packages/
│   ├── shared/              # Tipos, DTOs, validações
│   ├── database/            # Prisma schema/migrations
│   └── ui/                  # Componentes reutilizáveis
├── infra/
│   ├── docker/
│   ├── traefik/
│   └── scripts/
├── docs/
│   ├── mercado-pago.md
│   ├── estados-cobranca.md
│   ├── seguranca.md
│   ├── testes.md
│   └── operacao.md
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
└── README.md
```

## 4. Domínio, rotas públicas e infraestrutura

**Origem canônica:** `https://adapterpay.adapterco.com.br`.

- Landing: `/`
- Login: `/login`
- Cadastro: `/cadastro`
- Planos: `/planos`
- Checkout da assinatura: `/assinar/:planId` e `/assinatura/retorno`
- Painel: `/app`
- Lojas: `/app/lojas`
- POS: `/app/pos`
- Cobranças: `/app/cobrancas`
- Financeiro: `/app/financeiro`
- Usuários: `/app/usuarios`
- Mercado Pago: `/app/integracoes/mercado-pago`
- Assinatura: `/app/assinatura`
- Configurações: `/app/configuracoes`
- Contador: `/app/relatorios`
- Superadmin: `/superadmin` (autorização específica e MFA obrigatório)
- **Página fixa de POS:** `/p/:publicSlug`
- **Página individual da Order:** `/c/:publicToken`
- OAuth callback backend: `/api/v1/integrations/mercado-pago/callback`
- API: `/api/v1/...`
- SSE autenticado: `/api/v1/events/...`

Todos os links absolutos, callbacks OAuth, redirecionamentos de checkout e metadados usam `APP_URL=https://adapterpay.adapterco.com.br`. Nunca usar `localhost` em URLs de produção nem confiar cegamente em Host/X-Forwarded-* de clientes externos. Configurar `trust proxy` para Traefik conhecido.

Exemplo de `.env.example` (sem valores secretos reais):

```dotenv
NODE_ENV=production
APP_URL=https://adapterpay.adapterco.com.br
API_PUBLIC_URL=https://adapterpay.adapterco.com.br/api/v1
DATABASE_URL=postgresql://adapterpay:CHANGE_ME@postgres:5432/adapterpay
REDIS_URL=redis://redis:6379
SESSION_SECRET=CHANGE_ME
ENCRYPTION_KEY=CHANGE_ME
MP_CLIENT_ID=CHANGE_ME
MP_CLIENT_SECRET=CHANGE_ME
MP_OAUTH_REDIRECT_URI=https://adapterpay.adapterco.com.br/api/v1/integrations/mercado-pago/callback
MP_PLATFORM_CREDENTIALS_REF=CHANGE_ME
POLL_INTERVAL_SECONDS=3
CHARGE_EXPIRATION_SECONDS=180
TZ=UTC
```

Usar segredos via mecanismo protegido de deploy e não versionar `.env` real. OAuth callback e redirect URLs devem ser cadastrados no app Mercado Pago.

## 5. Multi-tenancy, lojas e contas Mercado Pago

Hierarquia: `tenant -> stores -> pos_terminals -> charges -> payments`.

- Cada tenant possui assinatura, usuários, lojas e configurações.
- Usuários podem pertencer a mais de uma loja via membership com papel e escopo.
- Loja possui uma **conexão MP recebedora** selecionada; uma conexão pode ser compartilhada entre lojas do mesmo tenant quando permitida.
- POS é vinculado a uma loja e à conexão MP correta; não permitir mover POS com Order pendente.
- Guardar IDs de loja e POS **do Mercado Pago** separadamente dos UUIDs internos. `external_id` de POS não é igual ao ID numérico de POS; usar o primeiro no payload da Order quando requerido.
- Não confiar em IDs enviados pelo cliente para resolver tenant: tenant vem da sessão/autorização.
- Evitar colisões de `external_id` no escopo relevante do provedor. Não usar `ADAPTERPAY` fixo para todos os tenants.

### Fluxo A — Criar loja/POS pelo AdapterPay

1. Admin conecta MP via OAuth e escolhe a conexão autorizada.
2. Cadastra loja no AdapterPay (nome, identificadores comerciais, endereço/dados obrigatórios do provedor, fuso).
3. Opcionalmente cria loja correspondente no MP via endpoint oficial suportado e persiste ID remoto.
4. Cria POS no MP por API oficial; gera `external_id` único, captura ID numérico, status e dados do QR.
5. Consulta `GET /v2/pos/{id}` para sincronizar `qr_response.qr_code`, imagem/template e metadados.
6. Ativa POS apenas quando plano permitir e vínculo remoto estiver válido.
7. Emite QR **da URL pública AdapterPay** para placa e NFC; a página exibe o Pix MP do POS na cobrança ativa.

### Fluxo B — Importar lojas/POS existentes

1. Após OAuth, buscar lojas e POS disponíveis à conta com paginação.
2. Mostrar seleção, associação à loja interna, prevenção de duplicatas e conflitos de propriedade.
3. Sincronizar ID remoto, `external_id`, modo, status e `qr_response`.
4. Se POS importado não tiver `external_id` válido para Orders, oferecer atualização/regularização **somente por operação suportada**; nunca assumir que basta alterar o banco local.
5. Respeitar limites do plano antes de ativar itens importados; permitir importação inativa para revisão.
6. Atualizar metadados periodicamente; registrar divergências, POS removidos no MP e credenciais revogadas.

**Atenção:** a rota de criação de POS `POST https://api.mercadopago.com/pos` foi informada, mas body, endpoint de loja, atualização/exclusão e requisitos de OAuth precisam ser implementados conforme documentação vigente e testes de contrato. Não inventar payloads.

## 6. OAuth Mercado Pago

- App OAuth da Adapter Co com Client ID/Secret de produção guardados apenas no backend.
- Iniciar OAuth em `/api/v1/integrations/mercado-pago/connect` com `state` criptograficamente aleatório, expiração curta e associação a tenant/admin/sessão.
- Callback valida `state`, troca authorization code por tokens no backend, obtém identidade da conta e armazena access/refresh tokens **criptografados** com controle de acesso e rotação.
- Verificar se conta já pertence a outro tenant; tratar conflitos explicitamente, sem assumir que mesmo usuário pode vincular uma conta em empresas diferentes.
- Renovar tokens de forma segura, serializada e com tolerância a concorrência; tratar revogação, escopos insuficientes e reconexão.
- Ações: conectar, listar, identificar, testar, reconectar, desconectar (somente sem dependências ativas ou com confirmação e regras).
- Nunca enviar tokens ao frontend, logs, Sentry, relatórios ou arquivos públicos.
- Distinguir **credenciais da plataforma** (assinaturas) das **credenciais dos lojistas** (vendas).

## 7. Contrato real de Orders QR comprovado pelo usuário

### Criar cobrança

`POST https://api.mercadopago.com/v1/orders`

```json
{
  "type": "qr",
  "total_amount": "99.00",
  "external_reference": "ADAPTERPAY_<UNIQUE_REFERENCE>",
  "expiration_time": "PT3M",
  "config": {
    "qr": {
      "external_pos_id": "ADAPTERPAY",
      "mode": "static"
    }
  },
  "transactions": {
    "payments": [{ "amount": "99.00" }]
  }
}
```

`ADAPTERPAY` é **exemplo real de um POS testado**, não valor fixo da aplicação. Substituir pelo `external_id` pertencente à loja e conexão MP da Order. Valores da API devem ser strings decimais com duas casas; converter de centavos de forma exata. Gerar `external_reference` globalmente único. Adicionar cabeçalho de idempotência quando exigido/recomendado pela API oficial; guardar a chave para retries da mesma operação.

Resposta de criação observada: `id` (Order ID `ORD...`), `status=created`, `status_detail=created`, `expiration_time=PT3M`, `transactions.payments[0].id` (`PAY...`), `amount`, `user_id`, `config.qr.external_pos_id`, `created_date`.

### Consultar Order

`GET https://api.mercadopago.com/v1/orders/{order_id}` com token da **mesma conta recebedora**.

**Pagamento confirmado observado:**

```json
{
  "id": "ORD01M57WJ30PXEDV609ZQQNSM482",
  "external_reference": "NFC_VENDA_000123",
  "total_amount": "1.00",
  "total_paid_amount": "1.00",
  "status": "processed",
  "status_detail": "accredited",
  "transactions": {
    "payments": [{
      "id": "PAY01M57WJ30Y1PG3ZEW57Y3RJHS6",
      "amount": "1.00",
      "paid_amount": "1.00",
      "reference_id": "183827516181",
      "status": "processed",
      "status_detail": "accredited",
      "payment_method": {"id": "pix", "type": "bank_transfer"}
    }]
  }
}
```

**Expiração observada:** `status=expired`, `status_detail=expired`, transação igualmente `expired`, com `expiration_time=PT3M`.

### Regra inegociável de aprovação

Marcar `PAID` **somente** se TODOS forem verdadeiros:

1. Order retornada pertence ao `order_id` da cobrança e ao token/conta MP recebedora correta.
2. `external_reference` corresponde exatamente à referência única da cobrança.
3. `currency=BRL`, valor esperado = `total_amount` e valor efetivamente pago (`total_paid_amount` e `paid_amount`) corresponde ao valor da cobrança, segundo regra explícita de tolerância zero para divergência.
4. Order: `status === "processed"` **e** `status_detail === "accredited"`.
5. Transação correspondente: `status === "processed"` **e** `status_detail === "accredited"`, `payment_method.id === "pix"` para vendas Pix.
6. `config.qr.external_pos_id`/vínculo recebedor conferem com o POS interno e a loja autorizada.
7. Idempotência: confirmação financeira e efeitos posteriores executados uma única vez em transação de banco.

**Qualquer outro status não confirma pagamento.** `created`, `expired`, `cancelled`, respostas incompletas, erro HTTP, timeout ou status desconhecido não são `PAID`. Diferenciar `UNKNOWN/RECONCILING` de `EXPIRED` para falhas de comunicação. Um pagamento confirmado nunca regride por uma resposta antiga. Guardar snapshots saneados das respostas para auditoria, sem tokens.

### Recuperar POS e Pix Copia e Cola

`GET https://api.mercadopago.com/v2/pos/{pos_id}`.

Campos comprovados: `id`, `name`, `status`, `user_id`, `store_id`, `external_id`, `config.qr.operating_mode`, `qr_response.uuid`, `qr_response.image`, `qr_response.template_document`, `qr_response.template_image`, `qr_response.qr_code`.

**`qr_response.qr_code` é o BR Code do POS**: utilizá-lo para exibir QR Pix na página e disponibilizar botão **Copiar Pix**; este comportamento foi testado pelo usuário, inclusive recebimento e tarifas zeradas em sua conta/modalidade. Não substituir por `external_reference`, `order_id` ou URL da plataforma.

**Dois QR distintos:**

- **QR físico impresso na placa / URL NFC:** `https://adapterpay.adapterco.com.br/p/{publicSlug}` — abre a página do AdapterPay.
- **QR Pix dentro da página:** representação visual do `qr_response.qr_code` do POS Mercado Pago — o cliente paga no app bancário.

A URL individual `/c/{publicToken}` identifica **uma Order**; no modo estático, pode exibir o mesmo BR Code do POS somente enquanto essa Order for a ativa e exclusiva do POS. Não apresentar o código como Pix dinâmico exclusivo. Após expiração ou substituição, o link individual não pode mostrar QR de nova Order.

## 8. Cobrança, concorrência e estados

### Fluxo principal

1. Admin/vendedor autorizado escolhe loja/POS e informa valor positivo em BRL, descrição opcional.
2. Backend verifica assinatura ativa, limites, permissões, OAuth válido, POS ativo e ausência de Order ativa conflitante.
3. Em transação de banco, reserva POS com exclusão mútua, cria registro `CREATING`, referência única e chave idempotente.
4. Chama Orders API; grava `order_id`, `payment_id`, `expires_at` calculado a partir da criação/expiração retornadas pelo MP, status `PENDING`.
5. Libera página pública do POS e link individual; SSE/polling atualizam valor e estado.
6. Worker consulta Order até estado final, respeitando rate limit.
7. Ao `processed/accredited` validado, confirma `PAID` em transação e emite evento interno para atualização do painel.
8. Ao `expired/expired` validado, marca `EXPIRED`; após estado terminal libera POS. Em erro/transição incerta, mantém `RECONCILING` e não reutiliza o POS até segurança financeira.

### Concorrência obrigatória

- **Máximo de uma Order ativa por POS estático.** Bloquear criação concorrente via índice/constraint e lock transacional; Redis sozinho não basta.
- Criar segunda cobrança no mesmo POS retorna `409 POS_BUSY`, incluindo referência e tempo restante para usuários autorizados.
- Duas pessoas na mesma página fixa podem ver a mesma cobrança; orientar o uso de POS separado por caixa/cliente para evitar troca de pagamentos.
- Link individual não implica simultaneidade no mesmo POS estático. Se futuramente houver QR dinâmico comprovado, criar um **modo separado** com contratos e testes específicos.
- Cancelamento manual somente quando operação remota oficial suportada e confirmada; não liberar POS por cancelamento local sem verificação.
- Falha após criar Order no MP e antes de gravar resposta: reconciliar pela chave de idempotência/referência antes de tentar nova criação.

### Estados internos

`CREATING`, `PENDING`, `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`, `RECONCILING`, `REFUNDED` (quando aplicável). Documentar transições válidas, irreversibilidade de `PAID` (reembolso é evento distinto) e tratamentos de atrasos.

### Expiração

- Prazo padrão **180 segundos** (`PT3M`), validado nos testes do usuário.
- O cronômetro é informativo; usar `expires_at` do backend, nunca confiar no relógio do cliente.
- Ao chegar ao prazo, verificar estado remoto; liberar POS somente após `expired`, `processed/accredited` ou outro encerramento remoto confiável.
- Worker de reconciliação posterior trata inconsistências, pagamentos atrasados, reinícios e quedas de API.

## 9. Polling — sem webhook de pagamento

- Um job ativo por Order pendente, intervalo inicial sugerido **3 segundos**, configurável; evitar múltiplos jobs por navegador.
- Redis/BullMQ + locks distribuídos, limite de concorrência por conta MP, HTTP 429 com backoff/jitter, timeout e circuit breaker.
- Frontend acompanha **nosso backend**, preferencialmente SSE; fallback a cada 2–3 segundos, com limites de conexão.
- Worker independente do painel e da página pública; continua quando todos os clientes fecharem navegador.
- Reconciliação agendada de Orders `PENDING`, `RECONCILING`, casos perto da expiração e divergências financeiras; registrar última consulta e próxima tentativa.
- Monitorar fila atrasada, tokens revogados e taxa de erros; não sobrecarregar MP com polling de Orders terminais.
- Para assinaturas, polling separado com cadência adequada à cobrança recorrente, sem supor que os mesmos endpoints/estados de Orders QR cobrem cartão recorrente.

## 10. Página pública e NFC

### `/p/:publicSlug` — permanente

- QR/NFC físico aponta para esta URL HTTPS.
- Se não houver cobrança: nome/logo da loja e estado **Aguardando cobrança**; atualizar automaticamente sem recarregar.
- Se houver Order pendente: nome da loja, nome do caixa, valor exato, contador de 03:00, QR Pix gerado do `qr_code`, botão **Copiar código Pix**, orientação para abrir app bancário.
- Se paga: estado **Pagamento confirmado**, sem divulgar dados privados do comprador; não permitir pagamento duplicado pelo link expirado.
- Se expirada: ocultar código e orientar solicitar nova cobrança ao vendedor.
- Não revelar dados pessoais, IDs internos, credenciais, histórico de outras cobranças ou acesso ao painel.
- Token/slug aleatório de alta entropia, rotacionável, com rate limit e cache control apropriado.

### `/c/:publicToken` — individual

- Token aleatório e não enumerável, associado imutavelmente a uma única Order.
- Exibir valor e QR Pix **somente enquanto aquela Order estiver ativa e for a cobrança atual do POS**.
- Não trocar automaticamente para a próxima cobrança do POS; após expirar, exibir estado final.
- Permitir copiar URL e gerar QR de acesso ao link individual para o vendedor compartilhar.
- Não permitir edição de valor ou reatribuição de recebedor pelo cliente.

### NFC

- Gravar registro NDEF URI com `https://adapterpay.adapterco.com.br/p/{publicSlug}`; sem app próprio.
- Não prometer cópia automática para clipboard ou abertura automática de Google Wallet via NFC: a página web fornece o botão Copiar Pix.
- Produção de placas personalizadas pode ficar para fase posterior; V1 deve gerar arquivo/QR da URL para impressão.

## 11. Perfis e autorização

- **SUPERADMIN:** equipe Adapter Co, gerencia planos, tenants, assinaturas, métricas, suporte e auditoria; MFA obrigatório, ações sensíveis auditadas; sem exposição de tokens.
- **ADMIN:** proprietário/administrador do tenant; lojas, POS, usuários, OAuth, assinaturas, cobranças, relatórios e configurações.
- **VENDEDOR:** cria cobrança e consulta vendas do dia nos POS/lojas autorizados; cancelamento de própria cobrança pendente somente se remoto permitir e política habilitada; sem acesso a tokens, planos, usuários ou relatórios globais.
- **CONTADOR:** somente leitura de pagamentos, histórico e relatórios das lojas atribuídas; exportação autorizada; não cria/cancela cobranças.

Todas as operações protegidas devem validar papel, membership, tenant e loja **no backend**. IDs da URL não substituem autorização. Aplicar MFA também ao admin para operações críticas, com recuperação segura.

## 12. Telas obrigatórias

### Site e onboarding

- Landing comercial AdapterPay, slogan e assinatura Adapter Co; benefícios, funcionamento QR/NFC, planos, FAQ, CTA.
- Cadastro, verificação de email, login, recuperação de senha, termos e política de privacidade.
- Seleção de plano, checkout Pix/cartão, página de pendência, confirmação e onboarding.
- Wizard: conectar MP OAuth -> cadastrar/importar lojas -> criar/importar POS -> gerar QR público -> primeira cobrança.

### Área administrativa

- Dashboard: recebido hoje, cobranças ativas/expiradas, vendas por loja/POS/vendedor, bruto, tarifa efetiva, líquido, gráficos e filtros.
- Cobrança rápida: selecionar loja/POS, valor, descrição, gerar Order, acompanhar contagem e status; feedback de POS ocupado.
- Cobranças: busca, filtros, detalhes, Order ID, referência, histórico, link individual, comprovante interno **não fiscal**.
- Lojas: CRUD, ativação/desativação, vinculação de MP, fuso, usuários, POS, importação/sincronização.
- POS: criar no MP, importar, sincronizar, editar conforme API, desativar, QR público, NFC, BR Code (acesso controlado), estados.
- Mercado Pago: conectar/reconectar, identidade, escopos, situação, divergências, desconexão segura.
- Usuários e permissões por loja; convites e desativação sem apagar histórico.
- Financeiro: relatórios, conciliação, divergências, CSV/XLSX, pagamentos e estornos.
- Assinatura: plano atual, uso de limites, faturas, pagamento Pix/cartão, upgrade, downgrade, cancelamento, status.
- Configurações: empresa, identidade visual, segurança, timezone, dados fiscais mínimos.

### Superadmin

- Tenants, status de assinaturas, planos e preços, pagamentos da plataforma, uso de POS/lojas/usuários, falhas OAuth, saúde do worker, logs de auditoria, suporte e bloqueios justificados.

## 13. Modelo de dados mínimo

Usar UUID interno e timestamps UTC, `tenant_id` em entidades multiempresa, FKs, índices compostos e unicidade por escopo.

- `tenants`: id, legal_name, trade_name, tax_id (criptografar/proteger conforme necessidade), status, timezone, created_at.
- `users`: id, email único normalizado, password_hash ou identidade de auth, mfa, status.
- `tenant_memberships`: tenant_id, user_id, role, status.
- `store_memberships`: store_id, user_id, permissões e escopo.
- `stores`: id, tenant_id, name, address, timezone, mp_store_id, mp_connection_id, status.
- `mp_connections`: id, tenant_id, mp_user_id, tokens criptografados, expiry, scopes, status, last_sync_at.
- `pos_terminals`: id, tenant_id, store_id, mp_connection_id, mp_pos_id, external_id, operating_mode, qr_code, qr_uuid, public_slug, status, active_charge_id.
- `charges`: id, tenant_id, store_id, pos_id, seller_id, mp_connection_id, order_id único, external_reference único, idempotency_key único, amount_cents, status, created_at, expires_at, paid_at, last_polled_at.
- `payments`: id, charge_id, mp_payment_id único por provedor/conta, mp_reference_id, amount_cents, paid_amount_cents, fee_cents nullable, net_amount_cents nullable, method, status, status_detail, confirmed_at.
- `payment_events`: id, charge_id, previous_state, new_state, provider_payload_redacted, occurred_at.
- `plans`: id, name, price_cents, max_pos, max_stores, max_users, active.
- `subscriptions`: id, tenant_id, plan_id, method, status, started_at, current_period_start/end, cancel_at_period_end.
- `invoices`: id, tenant_id, subscription_id, provider_reference, amount_cents, due_at, paid_at, status, attempt metadata.
- `polling_jobs` ou estado equivalente: charge_id, next_attempt_at, attempts, last_error, lease.
- `audit_logs`: actor, tenant, resource, action, before/after saneados, ip e timestamps.
- `oauth_states`: state_hash, tenant_id, user_id, expires_at, consumed_at.

Constraints críticas: uma cobrança ativa por POS estático (índice parcial ou mecanismo transacional equivalente); unicidade de `mp_pos_id` por conta; impedir associações cross-tenant; índice em `charges(order_id)`, `(tenant_id,created_at)`, `(pos_id,status)`.

## 14. API interna proposta

Autenticação e identidade:

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
GET  /api/v1/auth/me
```

Planos e assinatura:

```text
GET  /api/v1/plans
POST /api/v1/subscriptions/checkout
GET  /api/v1/subscriptions/current
GET  /api/v1/subscriptions/invoices
POST /api/v1/subscriptions/change-plan
POST /api/v1/subscriptions/cancel
GET  /api/v1/subscriptions/invoices/:id/status
```

OAuth e lojas:

```text
GET    /api/v1/integrations/mercado-pago/connect
GET    /api/v1/integrations/mercado-pago/callback
GET    /api/v1/integrations/mercado-pago/connections
POST   /api/v1/integrations/mercado-pago/connections/:id/reconnect
DELETE /api/v1/integrations/mercado-pago/connections/:id
GET    /api/v1/stores
POST   /api/v1/stores
PATCH  /api/v1/stores/:id
POST   /api/v1/stores/import/preview
POST   /api/v1/stores/import/confirm
POST   /api/v1/stores/:id/sync
```

POS e cobranças:

```text
GET    /api/v1/pos
POST   /api/v1/pos
PATCH  /api/v1/pos/:id
POST   /api/v1/pos/import/preview
POST   /api/v1/pos/import/confirm
POST   /api/v1/pos/:id/sync
POST   /api/v1/pos/:id/deactivate
GET    /api/v1/pos/:id/public-qr
POST   /api/v1/charges
GET    /api/v1/charges
GET    /api/v1/charges/:id
POST   /api/v1/charges/:id/cancel
GET    /api/v1/charges/:id/status
GET    /api/v1/reports/sales
GET    /api/v1/reports/export
```

Públicos, com rate limit e **somente campos seguros**:

```text
GET /api/v1/public/pos/:publicSlug
GET /api/v1/public/charges/:publicToken
GET /api/v1/public/pos/:publicSlug/events
GET /api/v1/public/charges/:publicToken/events
```

Administrativo:

```text
GET    /api/v1/users
POST   /api/v1/users/invite
PATCH  /api/v1/users/:id
GET    /api/v1/audit
GET    /api/v1/admin/tenants
GET    /api/v1/admin/subscriptions
GET    /api/v1/admin/operations/health
```

Documentar DTOs, autorização, idempotência, erros (`401`, `403`, `404`, `409 POS_BUSY`, `422`, `429`, `502/503`) e exemplos OpenAPI. **Endpoints internos acima são propostas de implementação, não endpoints já existentes.**

## 15. Segurança, LGPD e auditoria

- HTTPS obrigatório, HSTS, CSP adequada, cookies HttpOnly/Secure/SameSite, proteção CSRF onde aplicável.
- Password hashing Argon2id, MFA, controle de sessões, revogação, rate limiting e proteção contra brute force.
- Autorização no backend em toda operação; isolamento tenant/store com testes de acesso cruzado.
- OAuth `state` de uso único, tokens criptografados, rotação de chaves e acesso mínimo.
- Não armazenar dados completos de cartão, CVV, tokens MP em logs ou frontend.
- QR público não deve vazar informações pessoais ou histórico.
- Idempotência na criação e confirmação de pagamentos; auditoria de toda alteração sensível.
- Política de retenção, exclusão lógica e exportação LGPD; registros financeiros preservados conforme obrigações aplicáveis.
- Cuidado com QR adulterado: exibir nome da loja e valor, validar BR Code proveniente do POS correto, registrar mudanças de código.
- Backups PostgreSQL com criptografia e testes reais de restauração; planos de rollback de migração e deploy.
- Conformidade fiscal: recibo interno é **não fiscal**; não afirmar emissão de NF-e/NFC-e.

## 16. Integração financeira e tarifas

- A conta e modalidade testadas pelo usuário apresentaram **tarifa zero** em recebimentos Pix; registrar isso como resultado de teste, **não garantia para todos os tenants**.
- Consultar e persistir tarifas/valor líquido quando expostos pela API de pagamentos/relatórios do provedor; campos ausentes permanecem `null`, não inventar `0`.
- Não misturar transações dos lojistas com cobranças da assinatura AdapterPay.
- Não usar webhook de pagamento; polling e reconciliação são o único mecanismo de confirmação escolhido.
- Não usar WhatsApp nem qualquer dependência de API de mensagens.

## 17. Testes e critérios de aceite de ponta a ponta

### Testes unitários/integração

- Conversão centavos <-> strings decimais, limites de planos, RBAC, autorização por loja, idempotência, transições de estado.
- Simular resposta `created`, `processed/accredited`, `expired/expired`, valor divergente, Order divergente, token revogado, timeout, 429, resposta fora de ordem e pagamento após queda do worker.
- Corrida de duas requisições no mesmo POS: exatamente uma Order criada; segunda retorna 409.
- Retentativa de criação com mesma chave não duplica cobrança.
- Teste de acesso cross-tenant em cada endpoint sensível.

### Testes reais obrigatórios

1. Registrar tenant e contratar plano real; ativação somente após pagamento.
2. OAuth de conta MP lojista; persistência e renovação segura.
3. Criar loja e POS remoto pelo SaaS; recuperar QR e gerar placa com URL AdapterPay.
4. Importar loja/POS existentes sem duplicação e respeitando limites.
5. Criar Order de R$ 1,00, `PT3M`, no POS vinculado.
6. Abrir `/p/:slug`, copiar `qr_response.qr_code`, pagar em banco; confirmar por polling `processed/accredited` e valor correto.
7. Abrir `/c/:token` e verificar que só representa a Order original.
8. Criar cobrança e deixá-la expirar; confirmar `expired/expired`, liberar POS e impedir pagamento confirmado indevidamente.
9. Tentar duas cobranças simultâneas no mesmo POS; garantir bloqueio.
10. Reiniciar API/worker durante pagamento; garantir recuperação e conciliação.
11. Testar dois tenants com contas MP distintas; proibir leitura/criação cruzada.
12. Testar vendedor restrito, contador somente leitura e superadmin com auditoria.
13. Testar limites de POS, lojas e usuários para os quatro planos.
14. Testar vencimento sem tolerância, bloqueio de novas cobranças, continuidade da conciliação e reativação após pagamento.
15. Testar checkout de assinatura por Pix manual e cartão recorrente com renovação e falha de pagamento.
16. Conferir tarifas reais e líquido quando disponibilizados, sem assumir universalidade de taxa zero.
17. Testar QR/NFC em Android e iOS, desktop/tablet, telas pequenas, acessibilidade e comportamento com conexão lenta.

**Critério de pronto:** nenhum fluxo declarado concluído pode depender de mock; migrations aplicadas; testes de integração e E2E passando; operação observável; segredos protegidos; backup/restauração demonstrados; deploy HTTPS funcionando no domínio definido.

## 18. Deploy na VPS

- Docker Compose para `web`, `api`, `worker`, `postgres`, `redis` e `migrate` (job de migração separado).
- Rede interna isolada para banco/Redis; `web` e `api` conectados à rede Traefik externa configurada na VPS.
- Usar o Traefik existente, sem tentar publicar novamente portas 80/443 e sem ocupar porta 3000 do EasyPanel no host.
- Roteamento por Host(`adapterpay.adapterco.com.br`): `/api` para API; demais caminhos para Next.js. Prioridade maior para API; TLS via resolver já existente.
- Não presumir o nome exato da rede Traefik/entrypoint/certresolver; parametrizar e inspecionar a VPS antes do deploy. Exemplos: `TRAEFIK_NETWORK=traefik9`, `TRAEFIK_ENTRYPOINT=https`, `TRAEFIK_CERT_RESOLVER=letsencrypt` se forem os nomes reais no ambiente.
- Criar `.env.example`, Compose de produção, Dockerfiles multi-stage, healthchecks, política de restart, logs e documentação de rollback.
- DNS A/AAAA de `adapterpay.adapterco.com.br` apontando à VPS; certificado TLS válido e callback OAuth registrado com HTTPS exato.
- Comandos documentados para build, migrate, up, logs, healthcheck, backup, restore e rollback. Migração falha deve impedir release que dependa do schema novo.

## 19. Sequência de implementação obrigatória

**Etapa 1 — Fundação:** monorepo, Postgres, Prisma, autenticação, tenant, RBAC, migrations, Compose, Traefik, domínio, TLS. **Ainda não funciona:** cobrança MP, OAuth, assinaturas, POS.

**Etapa 2 — Comercial:** planos, limites, checkout Pix/cartão da plataforma, polling de assinaturas, bloqueio por inadimplência, onboarding. **Ainda não funciona:** recebimento lojista até concluir OAuth/POS/Orders.

**Etapa 3 — OAuth + lojas/POS:** conexão MP, criação e importação de lojas/POS, sincronização, QR do POS e URL pública. **Ainda não funciona:** pagamento fim a fim até implementar Orders/worker.

**Etapa 4 — Motor financeiro completo:** criar Order, polling, reconciliação, concorrência, expiração, estados, página fixa/individual, QR Pix, SSE. Somente declarar pronto após pagamento real e testes de expiração.

**Etapa 5 — Operação e relatórios:** dashboards, vendedor, contador, exportações, auditoria, superadmin, hardening e testes E2E completos.

Entregar cada etapa com **o que funciona, o que ainda não funciona, endpoints que retornarão erro/501 ou ainda não existem**, e passos verificáveis. Preferir executar o fluxo completo até produção de forma incremental, sem deixar implementação crítica apenas como TODO.

## 20. Pendências técnicas que não devem ser mascaradas

1. Validar contratos oficiais e permissões OAuth de criação/importação/edição de lojas e POS em contas de terceiros. `POST /pos` e `GET /v2/pos/{id}` são conhecidos; não presumir o restante.
2. Validar contrato e restrições reais da assinatura por cartão recorrente e Pix manual na conta MP da plataforma; sem webhooks financeiros, comprovar polling suficiente para todos os estados relevantes.
3. Confirmar condições tarifárias por conta/contrato: taxa zero comprovada nos testes do usuário, não garantia universal.
4. Confirmar eventuais limites/rate limits de consulta de Orders em escala e ajustar polling.
5. Confirmar política de cancelamento remoto e tratamento de Order incerta para liberar POS com segurança.

**Regra de engenharia:** documentar claramente cada lacuna, implementar testes de contrato e nunca substituir validação de pagamento real por mudança de estado no frontend.

---

**Entrega final esperada:** código-fonte completo, migrations, testes, Docker Compose, configuração Traefik, `.env.example`, documentação operacional, rotas funcionais, painel responsivo, integração MP real, assinatura real, QR/NFC público e cobrança Pix conciliada por polling, tudo publicado em **https://adapterpay.adapterco.com.br**.
