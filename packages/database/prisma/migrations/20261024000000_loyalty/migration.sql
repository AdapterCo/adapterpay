-- Fidelidade da loja: cashback em % ou brinde a cada N compras, com códigos de uso único.
ALTER TABLE "tenants"
  ADD COLUMN "loyalty_mode" TEXT NOT NULL DEFAULT 'OFF',
  ADD COLUMN "loyalty_cashback_bps" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "loyalty_gift_every" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "loyalty_gift_name" TEXT,
  ADD COLUMN "loyalty_min_purchase_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_loyalty_valid" CHECK (
  "loyalty_mode" IN ('OFF', 'CASHBACK', 'GIFT')
  AND "loyalty_cashback_bps" BETWEEN 1 AND 5000
  AND "loyalty_gift_every" BETWEEN 2 AND 100
  AND "loyalty_min_purchase_cents" >= 0
);

CREATE TABLE "loyalty_customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "purchase_count" INTEGER NOT NULL DEFAULT 0,
    "gift_progress" INTEGER NOT NULL DEFAULT 0,
    "total_spent_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loyalty_customers_tenant_id_phone_key" ON "loyalty_customers"("tenant_id", "phone");

ALTER TABLE "loyalty_customers" ADD CONSTRAINT "loyalty_customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loyalty_rewards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value_cents" INTEGER,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "earned_charge_id" UUID,
    "reserved_charge_id" UUID,
    "used_at" TIMESTAMPTZ(3),
    "notified_at" TIMESTAMPTZ(3),
    "notify_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loyalty_rewards_valid" CHECK (
      "kind" IN ('CASHBACK', 'GIFT')
      AND "status" IN ('AVAILABLE', 'RESERVED', 'USED', 'CANCELLED')
      AND ("kind" <> 'CASHBACK' OR "value_cents" > 0)
    )
);

CREATE UNIQUE INDEX "loyalty_rewards_tenant_id_code_key" ON "loyalty_rewards"("tenant_id", "code");
CREATE INDEX "loyalty_rewards_customer_id_status_idx" ON "loyalty_rewards"("customer_id", "status");
CREATE INDEX "loyalty_rewards_notified_at_idx" ON "loyalty_rewards"("notified_at");
-- Um código só pode estar reservado por uma cobrança de cada vez.
CREATE UNIQUE INDEX "loyalty_rewards_reserved_charge_key" ON "loyalty_rewards"("reserved_charge_id") WHERE "reserved_charge_id" IS NOT NULL;

ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "loyalty_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "charges"
  ADD COLUMN "loyalty_customer_id" UUID,
  ADD COLUMN "loyalty_reward_id" UUID,
  ADD COLUMN "discount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "charges" ADD CONSTRAINT "charges_discount_non_negative" CHECK ("discount_cents" >= 0);
ALTER TABLE "charges" ADD CONSTRAINT "charges_loyalty_customer_id_fkey"
  FOREIGN KEY ("loyalty_customer_id") REFERENCES "loyalty_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
