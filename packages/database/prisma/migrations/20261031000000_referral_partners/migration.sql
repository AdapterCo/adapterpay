-- Parceiros de indicação (sem conta): cadastro com nome, WhatsApp e chave Pix; acompanhamento por link secreto.
CREATE TABLE "referral_partners" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "pix_key_type" TEXT NOT NULL,
  "pix_key_enc" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "access_token_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "referral_partners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_partners_status_check" CHECK ("status" IN ('ACTIVE', 'BLOCKED')),
  CONSTRAINT "referral_partners_pix_key_type_check" CHECK ("pix_key_type" IN ('CPF_CNPJ', 'PHONE', 'EMAIL', 'RANDOM'))
);
CREATE UNIQUE INDEX "referral_partners_phone_key" ON "referral_partners"("phone");
CREATE UNIQUE INDEX "referral_partners_code_key" ON "referral_partners"("code");
CREATE UNIQUE INDEX "referral_partners_access_token_hash_key" ON "referral_partners"("access_token_hash");

CREATE TABLE "partner_payouts" (
  "id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "count" INTEGER NOT NULL,
  "note" TEXT,
  "actor_user_id" UUID NOT NULL,
  "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_payouts_amount_check" CHECK ("amount_cents" > 0 AND "count" > 0)
);
CREATE INDEX "partner_payouts_partner_id_paid_at_idx" ON "partner_payouts"("partner_id", "paid_at");
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "referral_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "partner_referrals" (
  "id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REGISTERED',
  "amount_cents" INTEGER NOT NULL DEFAULT 0,
  "earned_at" TIMESTAMPTZ(3),
  "payout_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_referrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_referrals_status_check" CHECK ("status" IN ('REGISTERED', 'EARNED', 'PAID_OUT')),
  CONSTRAINT "partner_referrals_paid_out_has_payout" CHECK ("status" <> 'PAID_OUT' OR "payout_id" IS NOT NULL)
);
-- Um lojista conta uma única vez para um único parceiro.
CREATE UNIQUE INDEX "partner_referrals_tenant_id_key" ON "partner_referrals"("tenant_id");
CREATE INDEX "partner_referrals_partner_id_status_idx" ON "partner_referrals"("partner_id", "status");
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "referral_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "partner_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tenants" ADD COLUMN "referred_by_partner_id" UUID;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_referred_by_partner_id_fkey"
  FOREIGN KEY ("referred_by_partner_id") REFERENCES "referral_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Um lojista tem no máximo uma origem de indicação (outro lojista ou um parceiro).
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_single_referrer" CHECK ("referred_by_tenant_id" IS NULL OR "referred_by_partner_id" IS NULL);
CREATE INDEX "tenants_referred_by_partner_id_idx" ON "tenants"("referred_by_partner_id");
