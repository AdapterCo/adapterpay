/**
 * Saneamento de payloads antes de persistir (payment_events, audit_logs) ou logar.
 * Remove credenciais e minimiza dados pessoais do pagador.
 */
const SECRET_KEY_RE = /(token|secret|authorization|password|cvv|security_code|card_number|code_verifier|cookie)/i;
const PII_KEY_RE = /^(email|first_name|last_name|identification|phone|address|payer_email)$/i;

export function redactPayload<T>(value: T, depth = 0): T {
  if (depth > 12) return '[TRUNCATED]' as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactPayload(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else if (PII_KEY_RE.test(k)) {
        out[k] = v === null || v === undefined ? v : '[PII]';
      } else if (k === 'payer' && v && typeof v === 'object') {
        // Mantém apenas o tipo do pagador, nunca a identidade.
        const payer = v as Record<string, unknown>;
        out[k] = { type: payer.type ?? null };
      } else {
        out[k] = redactPayload(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}
