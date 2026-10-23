-- Catálogo de produtos e itens das cobranças (cobrança rápida).
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_price_positive" CHECK ("price_cents" > 0)
);

CREATE INDEX "products_tenant_id_active_idx" ON "products"("tenant_id", "active");

ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "charge_items" (
    "id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "product_id" UUID,
    "name" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "charge_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "charge_items_values_positive" CHECK ("unit_price_cents" > 0 AND "quantity" > 0)
);

CREATE INDEX "charge_items_charge_id_idx" ON "charge_items"("charge_id");

ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_charge_id_fkey"
  FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
