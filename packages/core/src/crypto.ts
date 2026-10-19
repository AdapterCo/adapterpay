import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Criptografia de segredos em repouso (tokens MP, segredo MFA, documento fiscal).
 * AES-256-GCM, IV aleatório de 12 bytes, formato "keyId.iv.tag.ciphertext" (base64url).
 * Suporta rotação: novas cifras usam a chave atual; chaves anteriores só decifram.
 */
export class Encryptor {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    private readonly currentKeyId: string,
    currentKeyB64: string,
    previousKeys = '',
  ) {
    this.keys.set(currentKeyId, Encryptor.parseKey(currentKeyB64));
    for (const entry of previousKeys.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = entry.indexOf(':');
      if (idx <= 0) throw new Error('ENCRYPTION_PREVIOUS_KEYS inválido (use id:base64)');
      this.keys.set(entry.slice(0, idx), Encryptor.parseKey(entry.slice(idx + 1)));
    }
  }

  static parseKey(b64: string): Buffer {
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error('ENCRYPTION_KEY deve ter 32 bytes em base64');
    return key;
  }

  encrypt(plaintext: string): string {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(this.currentKeyId));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [this.currentKeyId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4) throw new Error('Cifra em formato inválido');
    const [keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Chave de criptografia desconhecida: ${keyId}`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAAD(Buffer.from(keyId));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** true se a cifra foi feita com chave antiga e deve ser regravada. */
  needsRotation(payload: string): boolean {
    return !payload.startsWith(`${this.currentKeyId}.`);
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Token aleatório de alta entropia, seguro para URL. 32 bytes = 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Slug público curto porém de alta entropia (128 bits), sem caracteres ambíguos. */
export function randomSlug(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(26);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
