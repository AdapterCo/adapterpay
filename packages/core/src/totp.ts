import { createHmac, randomBytes } from 'node:crypto';
import { sha256Hex } from './crypto';

/** TOTP (RFC 6238) com HMAC-SHA1, 6 dígitos, passo de 30s — compatível com apps autenticadores. */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, timeMs: number, stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    (((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!) %
    10 ** digits;
  return code.toString().padStart(digits, '0');
}

/** Aceita janela de ±1 passo para tolerar diferença de relógio. */
export function verifyTotp(secret: string, code: string, nowMs = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (let w = -window; w <= window; w++) {
    if (totpAt(secret, nowMs + w * 30_000) === code) return true;
  }
  return false;
}

export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Gera códigos de recuperação legíveis (XXXX-XXXX) e seus hashes para armazenamento. */
export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(8);
    let s = '';
    for (const b of bytes) s += alphabet[b % alphabet.length];
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return { codes, hashes: codes.map((c) => sha256Hex(c.toUpperCase())) };
}
