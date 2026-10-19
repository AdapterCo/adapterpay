# AdapterPay

> **Seu negócio recebe. Você acompanha.** — Uma plataforma da Adapter Co.
> Produção: https://adapterpay.adapterco.com.br

SaaS multiempresa de pagamentos presenciais Pix via Mercado Pago: QR Code fixo por POS, NFC apontando para a página pública e links individuais de cobrança. O vendedor define o valor; o dinheiro cai **diretamente** na conta Mercado Pago do lojista (sem custódia, sem comissão). A confirmação é feita **somente por polling no backend** (sem webhook de pagamento).

## Monorepo

```
apps/web        Next.js 15 (App Router) + Tailwind 4 — site, painel, superadmin, páginas públicas /p e /c
apps/api        NestJS 11 — REST /api/v1, SSE, OpenAPI protegido
apps/worker     BullMQ — polling de Orders, reconciliação, billing, tarifas, sync de POS, tokens
packages/shared Tipos, schemas zod, regra de aprovação de Order, dinheiro em centavos, BR Code
packages/database Prisma schema + migrations (PostgreSQL 17) + seed de planos
packages/core   Núcleo servidor compartilhado: cliente Mercado Pago, OAuth/tokens, motor de cobranças, billing
packages/ui     Componentes React acessíveis
infra/          Dockerfile multi-stage, scripts de deploy/backup/restore/rollback, Traefik, segredos
docs/           mercado-pago, estados-cobranca, seguranca, testes, operacao, assinaturas, etapas
```

> Desvio documentado da estrutura sugerida: `packages/core` foi adicionado para que API e worker compartilhem exatamente o mesmo código financeiro (criação/confirmação de Orders, billing), evitando divergência entre processos.

## Desenvolvimento local

Requisitos: Node 22+, pnpm 10, Docker (Postgres/Redis).

```bash
pnpm install
docker compose up -d                       # postgres:17 + redis em 127.0.0.1
cp .env.example .env                       # ajuste para dev (ver abaixo)
pnpm build:packages
pnpm db:migrate:deploy && pnpm db:seed
pnpm dev:api      # http://localhost:4000/api/v1
pnpm dev:worker
pnpm dev:web      # http://localhost:3000 (API_INTERNAL_URL=http://localhost:4000)
```

`.env` de desenvolvimento: `NODE_ENV=development`, `APP_URL=http://localhost:3000`, `API_PUBLIC_URL=http://localhost:3000/api/v1`, `DATABASE_URL=postgresql://adapterpay:adapterpay_dev@localhost:5432/adapterpay`, `REDIS_URL=redis://localhost:6379`, `ENCRYPTION_KEY=$(openssl rand -base64 32)`, `SESSION_SECRET` com 32+ caracteres e credenciais de um app Mercado Pago de teste. Sem SMTP em dev, os links de email aparecem no log da API.

Superadmin: `pnpm --filter @adapterpay/api build && pnpm --filter @adapterpay/api cli:create-superadmin voce@adapterco.com.br "Nome"` (MFA obrigatório no primeiro login).

## Testes

```bash
pnpm test                                   # unitários (shared, core, api)
TEST_DATABASE_URL=postgresql://... pnpm test:integration   # PostgreSQL real, migrations aplicadas
```

Detalhes e checklist dos testes reais obrigatórios: [docs/testes.md](docs/testes.md).

## Produção

Docker Compose na VPS Debian 13 com o **Traefik existente** — ver [docs/operacao.md](docs/operacao.md) e [infra/traefik/README.md](infra/traefik/README.md).

```bash
infra/scripts/deploy.sh
```

## Situação

O que funciona, o que depende de validação na conta Mercado Pago e os testes reais ainda pendentes estão em [docs/etapas.md](docs/etapas.md). **Nenhum fluxo financeiro deve ser considerado pronto para produção antes dos testes reais da seção 17.**
