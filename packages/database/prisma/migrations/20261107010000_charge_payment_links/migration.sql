-- Links de pagamento passam a ser cobranças comuns (mesma criação de Order no POS), com validade de 24 h.
DROP TABLE IF EXISTS "payment_links";

ALTER TABLE "charges"
  ADD COLUMN "is_payment_link" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customer_name" TEXT,
  ADD COLUMN "customer_search" TEXT,
  ADD COLUMN "customer_phone" TEXT;

ALTER TABLE "charges"
  ADD CONSTRAINT "charges_payment_link_customer" CHECK (NOT "is_payment_link" OR "customer_name" IS NOT NULL);

CREATE INDEX "charges_tenant_id_is_payment_link_created_at_idx" ON "charges" ("tenant_id", "is_payment_link", "created_at");
