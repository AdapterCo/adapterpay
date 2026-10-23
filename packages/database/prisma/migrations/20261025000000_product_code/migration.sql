-- Código do produto (EAN ou interno) para o leitor de código de barras no caixa. Único por empresa.
ALTER TABLE "products" ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "products_tenant_id_code_key" ON "products"("tenant_id", "code");
