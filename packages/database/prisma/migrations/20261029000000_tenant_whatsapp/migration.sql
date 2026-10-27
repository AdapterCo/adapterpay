-- WhatsApp próprio do lojista (instância Evolution) para enviar os códigos de fidelidade.
ALTER TABLE "tenants" ADD COLUMN "whatsapp_instance" TEXT;
ALTER TABLE "tenants" ADD COLUMN "whatsapp_number" TEXT;
ALTER TABLE "tenants" ADD COLUMN "whatsapp_connected_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "tenants_whatsapp_instance_key" ON "tenants"("whatsapp_instance");
