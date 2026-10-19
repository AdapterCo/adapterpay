-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('ADMIN', 'VENDEDOR', 'CONTADOR');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MpConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT', 'REVOKED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "PosStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'REMOTE_MISSING', 'NEEDS_REGULARIZATION');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('CREATING', 'PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED', 'RECONCILING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('PIX', 'CARD');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('INITIAL', 'RENEWAL', 'UPGRADE');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'INVITE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SUPERADMIN', 'SYSTEM', 'WORKER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT NOT NULL,
    "tax_id_enc" TEXT NOT NULL,
    "tax_id_hash" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "logo_url" TEXT,
    "brand_color" TEXT,
    "fiscal_address" TEXT,
    "allow_seller_cancel" BOOLEAN NOT NULL DEFAULT false,
    "require_admin_mfa" BOOLEAN NOT NULL DEFAULT false,
    "suspended_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMPTZ(3),
    "is_superadmin" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "mfa_enabled_at" TIMESTAMPTZ(3),
    "mfa_recovery_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "active_tenant_id" UUID,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "mp_store_id" TEXT,
    "mp_external_id" TEXT,
    "mp_connection_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMPTZ(3),
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mp_user_id" TEXT NOT NULL,
    "nickname" TEXT,
    "email" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "live_mode" BOOLEAN,
    "status" "MpConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMPTZ(3),
    "last_tested_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "connected_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_terminals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "mp_connection_id" UUID NOT NULL,
    "mp_pos_id" TEXT NOT NULL,
    "mp_store_id" TEXT,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "operating_mode" TEXT,
    "qr_code" TEXT,
    "qr_code_hash" TEXT,
    "qr_uuid" TEXT,
    "qr_image_url" TEXT,
    "qr_template_document" TEXT,
    "qr_template_image" TEXT,
    "qr_updated_at" TIMESTAMPTZ(3),
    "remote_status" TEXT,
    "public_slug" TEXT NOT NULL,
    "status" "PosStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "active_charge_id" UUID,
    "created_remotely" BOOLEAN NOT NULL DEFAULT false,
    "last_sync_at" TIMESTAMPTZ(3),
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "pos_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "mp_connection_id" UUID NOT NULL,
    "order_id" TEXT,
    "mp_payment_id" TEXT,
    "external_reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "client_request_id" TEXT,
    "external_pos_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "description" TEXT,
    "status" "ChargeStatus" NOT NULL DEFAULT 'CREATING',
    "status_reason" TEXT,
    "public_token" TEXT NOT NULL,
    "mp_created_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "terminal_at" TIMESTAMPTZ(3),
    "last_polled_at" TIMESTAMPTZ(3),
    "cancel_requested_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mp_connection_id" UUID NOT NULL,
    "mp_payment_id" TEXT NOT NULL,
    "mp_reference_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "paid_amount_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER,
    "net_amount_cents" INTEGER,
    "fee_synced_at" TIMESTAMPTZ(3),
    "fee_sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "status_detail" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "previous_state" "ChargeStatus",
    "new_state" "ChargeStatus" NOT NULL,
    "reason" TEXT,
    "provider_payload_redacted" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polling_jobs" (
    "charge_id" UUID NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consecutive_errors" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMPTZ(3),
    "lease_owner" TEXT,
    "lease_until" TIMESTAMPTZ(3),
    "post_terminal_check_at" TIMESTAMPTZ(3),
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "polling_jobs_pkey" PRIMARY KEY ("charge_id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "max_pos" INTEGER NOT NULL,
    "max_stores" INTEGER NOT NULL,
    "max_users" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" TEXT NOT NULL,
    "method" "BillingMethod",
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "scheduled_plan_id" TEXT,
    "mp_preapproval_id" TEXT,
    "preapproval_status" TEXT,
    "next_poll_at" TIMESTAMPTZ(3),
    "last_polled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "plan_id" TEXT NOT NULL,
    "method" "BillingMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "provider_reference" TEXT,
    "provider_status" TEXT,
    "external_reference" TEXT NOT NULL,
    "pix_qr_code" TEXT,
    "pix_qr_base64" TEXT,
    "pix_expires_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "next_poll_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL,
    "state_hash" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "connection_id" UUID,
    "code_verifier_enc" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_tax_id_hash_idx" ON "tenants"("tax_id_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE INDEX "tenant_memberships_tenant_id_status_idx" ON "tenant_memberships"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "store_memberships_tenant_id_user_id_idx" ON "store_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_memberships_store_id_user_id_key" ON "store_memberships"("store_id", "user_id");

-- CreateIndex
CREATE INDEX "stores_tenant_id_status_idx" ON "stores"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stores_id_tenant_id_key" ON "stores"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_mp_connection_id_mp_store_id_key" ON "stores"("mp_connection_id", "mp_store_id");

-- CreateIndex
CREATE INDEX "mp_connections_mp_user_id_idx" ON "mp_connections"("mp_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_connections_id_tenant_id_key" ON "mp_connections"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_connections_tenant_id_mp_user_id_key" ON "mp_connections"("tenant_id", "mp_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_public_slug_key" ON "pos_terminals"("public_slug");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_active_charge_id_key" ON "pos_terminals"("active_charge_id");

-- CreateIndex
CREATE INDEX "pos_terminals_tenant_id_status_idx" ON "pos_terminals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "pos_terminals_store_id_idx" ON "pos_terminals"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_id_tenant_id_key" ON "pos_terminals"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_mp_connection_id_mp_pos_id_key" ON "pos_terminals"("mp_connection_id", "mp_pos_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_mp_connection_id_external_id_key" ON "pos_terminals"("mp_connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "charges_order_id_key" ON "charges"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "charges_external_reference_key" ON "charges"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "charges_idempotency_key_key" ON "charges"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "charges_public_token_key" ON "charges"("public_token");

-- CreateIndex
CREATE INDEX "charges_tenant_id_created_at_idx" ON "charges"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "charges_pos_id_status_idx" ON "charges"("pos_id", "status");

-- CreateIndex
CREATE INDEX "charges_status_idx" ON "charges"("status");

-- CreateIndex
CREATE INDEX "charges_seller_id_created_at_idx" ON "charges"("seller_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "charges_tenant_id_client_request_id_key" ON "charges"("tenant_id", "client_request_id");

-- CreateIndex
CREATE INDEX "payments_charge_id_idx" ON "payments"("charge_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_confirmed_at_idx" ON "payments"("tenant_id", "confirmed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mp_connection_id_mp_payment_id_key" ON "payments"("mp_connection_id", "mp_payment_id");

-- CreateIndex
CREATE INDEX "payment_events_charge_id_occurred_at_idx" ON "payment_events"("charge_id", "occurred_at");

-- CreateIndex
CREATE INDEX "polling_jobs_done_next_attempt_at_idx" ON "polling_jobs"("done", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_mp_preapproval_id_key" ON "subscriptions"("mp_preapproval_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_provider_reference_key" ON "invoices"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_external_reference_key" ON "invoices"("external_reference");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_created_at_idx" ON "invoices"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_status_due_at_idx" ON "invoices"("status", "due_at");

-- CreateIndex
CREATE INDEX "invoices_status_next_poll_at_idx" ON "invoices"("status", "next_poll_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_created_at_idx" ON "notifications"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_store_id_tenant_id_fkey" FOREIGN KEY ("store_id", "tenant_id") REFERENCES "stores"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_mp_connection_id_fkey" FOREIGN KEY ("mp_connection_id") REFERENCES "mp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_connections" ADD CONSTRAINT "mp_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_store_id_tenant_id_fkey" FOREIGN KEY ("store_id", "tenant_id") REFERENCES "stores"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_mp_connection_id_tenant_id_fkey" FOREIGN KEY ("mp_connection_id", "tenant_id") REFERENCES "mp_connections"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_store_id_tenant_id_fkey" FOREIGN KEY ("store_id", "tenant_id") REFERENCES "stores"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_pos_id_tenant_id_fkey" FOREIGN KEY ("pos_id", "tenant_id") REFERENCES "pos_terminals"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_mp_connection_id_tenant_id_fkey" FOREIGN KEY ("mp_connection_id", "tenant_id") REFERENCES "mp_connections"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polling_jobs" ADD CONSTRAINT "polling_jobs_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_id_fkey" FOREIGN KEY ("scheduled_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
