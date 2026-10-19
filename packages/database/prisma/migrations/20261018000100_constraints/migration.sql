-- Constraints críticas (seção 13) que o Prisma Schema não expressa.
-- Mantidas em migration própria para facilitar auditoria. Não remover em migrations futuras.

-- 1. Máximo de UMA cobrança ativa por POS estático (seção 8 — concorrência obrigatória).
--    Complementa o lock transacional (SELECT ... FOR UPDATE no POS) — Redis sozinho não basta.
CREATE UNIQUE INDEX "charges_one_active_per_pos"
  ON "charges" ("pos_id")
  WHERE "status" IN ('CREATING', 'PENDING', 'RECONCILING');

-- 2. Loja só pode apontar para conexão MP do MESMO tenant (impede associação cross-tenant).
--    MATCH SIMPLE: quando mp_connection_id é NULL a constraint não se aplica.
ALTER TABLE "stores"
  ADD CONSTRAINT "stores_mp_connection_same_tenant_fkey"
  FOREIGN KEY ("mp_connection_id", "tenant_id")
  REFERENCES "mp_connections" ("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Uma conta Mercado Pago (mp_user_id) só pode estar vinculada a um tenant por vez
--    enquanto a conexão não estiver desconectada. Conflitos são tratados explicitamente na API.
CREATE UNIQUE INDEX "mp_connections_one_active_owner"
  ON "mp_connections" ("mp_user_id")
  WHERE "status" <> 'DISCONNECTED';

-- 4. Sanidade monetária.
ALTER TABLE "charges" ADD CONSTRAINT "charges_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "charges" ADD CONSTRAINT "charges_currency_brl" CHECK ("currency" = 'BRL');
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_non_negative"
  CHECK ("amount_cents" >= 0 AND "paid_amount_cents" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "plans" ADD CONSTRAINT "plans_limits_positive"
  CHECK ("price_cents" > 0 AND "max_pos" > 0 AND "max_stores" > 0 AND "max_users" > 0);

-- 5. active_charge_id do POS referencia uma cobrança existente do próprio POS.
ALTER TABLE "pos_terminals"
  ADD CONSTRAINT "pos_terminals_active_charge_fkey"
  FOREIGN KEY ("active_charge_id") REFERENCES "charges" ("id")
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- 6. PAID é irreversível: só pode evoluir para REFUNDED. Defesa em profundidade além da regra de aplicação.
CREATE OR REPLACE FUNCTION adapterpay_guard_paid_charge() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PAID' AND NEW."status" NOT IN ('PAID', 'REFUNDED') THEN
    RAISE EXCEPTION 'charge % is PAID and cannot transition to %', OLD."id", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'REFUNDED' AND NEW."status" <> 'REFUNDED' THEN
    RAISE EXCEPTION 'charge % is REFUNDED and cannot transition to %', OLD."id", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."amount_cents" <> NEW."amount_cents" OR OLD."external_reference" <> NEW."external_reference"
     OR OLD."public_token" <> NEW."public_token" OR OLD."pos_id" <> NEW."pos_id" THEN
    RAISE EXCEPTION 'charge % immutable fields cannot change', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "charges_guard_paid"
  BEFORE UPDATE ON "charges"
  FOR EACH ROW EXECUTE FUNCTION adapterpay_guard_paid_charge();

-- 7. Índices auxiliares de polling/reconciliação.
CREATE INDEX "charges_active_expires_idx"
  ON "charges" ("expires_at")
  WHERE "status" IN ('CREATING', 'PENDING', 'RECONCILING');
