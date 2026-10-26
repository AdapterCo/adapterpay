-- Modo Restaurante: mesas com POS próprio e conta paga integral ou dividida (uma parte por vez).
ALTER TABLE "tenants" ADD COLUMN "restaurant_mode" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "restaurant_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "pos_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "public_slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_tables_status_valid" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);

CREATE UNIQUE INDEX "restaurant_tables_public_slug_key" ON "restaurant_tables"("public_slug");
CREATE INDEX "restaurant_tables_tenant_id_status_idx" ON "restaurant_tables"("tenant_id", "status");
-- Um POS atende no máximo uma mesa ativa.
CREATE UNIQUE INDEX "restaurant_tables_one_active_per_pos" ON "restaurant_tables"("pos_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_pos_id_fkey"
  FOREIGN KEY ("pos_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "table_bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT,
    "split_count" INTEGER,
    "paid_shares" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "table_bills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "table_bills_valid" CHECK (
      "total_cents" > 0 AND "paid_cents" >= 0 AND "paid_shares" >= 0
      AND ("mode" IS NULL OR "mode" IN ('FULL', 'SPLIT'))
      AND ("split_count" IS NULL OR "split_count" BETWEEN 2 AND 50)
      AND "status" IN ('OPEN', 'PAID', 'CANCELLED')
    )
);

CREATE INDEX "table_bills_tenant_id_status_idx" ON "table_bills"("tenant_id", "status");
CREATE INDEX "table_bills_table_id_status_idx" ON "table_bills"("table_id", "status");
-- No máximo uma conta aberta por mesa.
CREATE UNIQUE INDEX "table_bills_one_open_per_table" ON "table_bills"("table_id") WHERE "status" = 'OPEN';

ALTER TABLE "table_bills" ADD CONSTRAINT "table_bills_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_bills" ADD CONSTRAINT "table_bills_table_id_fkey"
  FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "charges" ADD COLUMN "table_bill_id" UUID;
ALTER TABLE "charges" ADD CONSTRAINT "charges_table_bill_id_fkey"
  FOREIGN KEY ("table_bill_id") REFERENCES "table_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "charges_table_bill_id_idx" ON "charges"("table_bill_id") WHERE "table_bill_id" IS NOT NULL;
