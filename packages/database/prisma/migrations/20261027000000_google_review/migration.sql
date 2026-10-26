-- Link de avaliação no Google exibido ao cliente após o pagamento aprovado.
ALTER TABLE "tenants" ADD COLUMN "google_review_url" TEXT;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_google_review_url_https"
  CHECK ("google_review_url" IS NULL OR "google_review_url" LIKE 'https://%');
