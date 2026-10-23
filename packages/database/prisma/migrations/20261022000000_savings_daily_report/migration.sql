-- "Quanto você economizou" (taxas de referência em pontos-base) e fechamento de caixa diário por WhatsApp.
ALTER TABLE "tenants"
  ADD COLUMN "savings_pos_rate_bps" INTEGER NOT NULL DEFAULT 49,
  ADD COLUMN "savings_link_rate_bps" INTEGER NOT NULL DEFAULT 99,
  ADD COLUMN "daily_report_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "daily_report_phone" TEXT,
  ADD COLUMN "daily_report_hour" INTEGER NOT NULL DEFAULT 22;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_savings_rates_range"
  CHECK ("savings_pos_rate_bps" BETWEEN 0 AND 2000 AND "savings_link_rate_bps" BETWEEN 0 AND 2000);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_daily_report_hour_range"
  CHECK ("daily_report_hour" BETWEEN 0 AND 23);

CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_reports_tenant_id_day_key" ON "daily_reports"("tenant_id", "day");
CREATE INDEX "daily_reports_status_idx" ON "daily_reports"("status");

ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
