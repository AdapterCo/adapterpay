-- Indicação de lojistas: código próprio, quem indicou, saldo de créditos e extrato.
ALTER TABLE "tenants" ADD COLUMN "referral_code" TEXT;
ALTER TABLE "tenants" ADD COLUMN "referred_by_tenant_id" UUID;
ALTER TABLE "tenants" ADD COLUMN "billing_credit_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_billing_credit_cents_nonneg" CHECK ("billing_credit_cents" >= 0);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_referred_by_tenant_id_fkey"
  FOREIGN KEY ("referred_by_tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_not_self_referred" CHECK ("referred_by_tenant_id" IS NULL OR "referred_by_tenant_id" <> "id");
CREATE INDEX "tenants_referred_by_tenant_id_idx" ON "tenants"("referred_by_tenant_id");

-- Código para os lojistas existentes (alfabeto sem 0/O e 1/I/L, 8 caracteres).
-- A subconsulta referencia "id" para ser avaliada por linha (cada lojista recebe um código diferente).
UPDATE "tenants" SET "referral_code" = (
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 8 + 0 * length("id"::text))
);
CREATE UNIQUE INDEX "tenants_referral_code_key" ON "tenants"("referral_code");

ALTER TABLE "subscriptions" ADD COLUMN "card_credit_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "credit_applied_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_applied_cents_nonneg" CHECK ("credit_applied_cents" >= 0);

CREATE TABLE "billing_credits" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "referred_tenant_id" UUID,
  "invoice_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_credits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_credits_kind_check" CHECK ("kind" IN ('REFERRAL_WELCOME', 'REFERRAL_BONUS', 'INVOICE'))
);
CREATE UNIQUE INDEX "billing_credits_invoice_id_key" ON "billing_credits"("invoice_id");
-- Uma recompensa de cada tipo por lojista indicado: o desconto de boas-vindas nunca se repete.
CREATE UNIQUE INDEX "billing_credits_kind_referred_tenant_id_key" ON "billing_credits"("kind", "referred_tenant_id");
CREATE INDEX "billing_credits_tenant_id_created_at_idx" ON "billing_credits"("tenant_id", "created_at");
ALTER TABLE "billing_credits" ADD CONSTRAINT "billing_credits_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
