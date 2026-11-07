-- Links de pagamento externos: Pix avulso na conta Mercado Pago da loja, válido por 24 h, sem POS.
CREATE TABLE "payment_links" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "mp_connection_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "customer_name" TEXT NOT NULL,
  "customer_search" TEXT NOT NULL,
  "customer_phone" TEXT,
  "description" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "external_reference" TEXT NOT NULL,
  "public_token" TEXT NOT NULL,
  "mp_payment_id" TEXT,
  "pix_copy_paste" TEXT,
  "provider_status" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "paid_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "fee_cents" INTEGER,
  "net_amount_cents" INTEGER,
  "next_poll_at" TIMESTAMPTZ(3),
  "last_polled_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_links_status_check" CHECK ("status" IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT "payment_links_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "payment_links_paid_check" CHECK ("status" <> 'PAID' OR "paid_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "payment_links_external_reference_key" ON "payment_links"("external_reference");
CREATE UNIQUE INDEX "payment_links_public_token_key" ON "payment_links"("public_token");
CREATE INDEX "payment_links_tenant_id_created_at_idx" ON "payment_links"("tenant_id", "created_at");
CREATE INDEX "payment_links_tenant_id_status_idx" ON "payment_links"("tenant_id", "status");
CREATE INDEX "payment_links_status_next_poll_at_idx" ON "payment_links"("status", "next_poll_at");

ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_store_id_tenant_id_fkey"
  FOREIGN KEY ("store_id", "tenant_id") REFERENCES "stores"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_mp_connection_id_tenant_id_fkey"
  FOREIGN KEY ("mp_connection_id", "tenant_id") REFERENCES "mp_connections"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
