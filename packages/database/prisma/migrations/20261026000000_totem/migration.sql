-- Modo totem: dispositivos de autoatendimento, fotos de produto, número de pedido e adicional por totem.
ALTER TABLE "plans" ADD COLUMN "totem_price_cents" INTEGER;
ALTER TABLE "plans" ADD CONSTRAINT "plans_totem_price_positive" CHECK ("totem_price_cents" IS NULL OR "totem_price_cents" > 0);

ALTER TABLE "subscriptions" ADD COLUMN "totem_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_totem_quantity_non_negative" CHECK ("totem_quantity" >= 0);

ALTER TABLE "products" ADD COLUMN "image_key" TEXT;

CREATE TABLE "totem_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "pos_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT,
    "pairing_code_hash" TEXT,
    "pairing_expires_at" TIMESTAMPTZ(3),
    "paired_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "totem_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "totem_devices_status_valid" CHECK ("status" IN ('ACTIVE', 'REVOKED'))
);

CREATE UNIQUE INDEX "totem_devices_token_hash_key" ON "totem_devices"("token_hash");
CREATE UNIQUE INDEX "totem_devices_pairing_code_hash_key" ON "totem_devices"("pairing_code_hash");
CREATE INDEX "totem_devices_tenant_id_status_idx" ON "totem_devices"("tenant_id", "status");
-- Um POS atende no máximo um totem ativo (o Mercado Pago aceita uma cobrança ativa por POS).
CREATE UNIQUE INDEX "totem_devices_one_active_per_pos" ON "totem_devices"("pos_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "totem_devices" ADD CONSTRAINT "totem_devices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "totem_devices" ADD CONSTRAINT "totem_devices_pos_id_fkey"
  FOREIGN KEY ("pos_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "totem_devices" ADD CONSTRAINT "totem_devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "order_counters" (
    "store_id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("store_id", "day")
);

ALTER TABLE "charges"
  ADD COLUMN "totem_id" UUID,
  ADD COLUMN "order_number" INTEGER,
  ADD COLUMN "fulfillment_status" TEXT,
  ADD COLUMN "fulfilled_at" TIMESTAMPTZ(3);
ALTER TABLE "charges" ADD CONSTRAINT "charges_fulfillment_status_valid"
  CHECK ("fulfillment_status" IS NULL OR "fulfillment_status" IN ('PREPARING', 'READY', 'DELIVERED'));
ALTER TABLE "charges" ADD CONSTRAINT "charges_totem_id_fkey"
  FOREIGN KEY ("totem_id") REFERENCES "totem_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "charges_store_id_order_number_idx" ON "charges"("store_id", "paid_at") WHERE "order_number" IS NOT NULL;
