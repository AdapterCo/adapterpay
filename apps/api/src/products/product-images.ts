import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { CoreDeps } from '@adapterpay/core';
import { Errors } from '../common/errors';
import { CORE } from '../common/tokens';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const KEY_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Tipo real pela assinatura do arquivo (nunca pelo Content-Type enviado). */
function detect(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/** Fotos de produto no volume de uploads, com nomes aleatórios (não adivinháveis, cache imutável). */
@Injectable()
export class ProductImages {
  private readonly dir: string;

  constructor(@Inject(CORE) deps: CoreDeps) {
    this.dir = path.resolve(deps.config.UPLOADS_DIR, 'products');
  }

  async save(buf: unknown): Promise<string> {
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw Errors.validation('Envie a foto como JPEG, PNG ou WebP');
    if (buf.length > MAX_IMAGE_BYTES) throw Errors.validation('Foto acima de 2 MB');
    const ext = detect(buf);
    if (!ext) throw Errors.validation('Formato não suportado. Use JPEG, PNG ou WebP');
    const key = `${randomBytes(16).toString('hex')}.${ext}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, key), buf, { mode: 0o640 });
    return key;
  }

  async remove(key: string | null | undefined): Promise<void> {
    if (!key || !KEY_RE.test(key)) return;
    await unlink(path.join(this.dir, key)).catch(() => undefined);
  }

  async read(key: string): Promise<{ data: Buffer; mime: string }> {
    if (!KEY_RE.test(key)) throw Errors.notFound('Imagem');
    try {
      const data = await readFile(path.join(this.dir, key));
      return { data, mime: MIME[key.split('.').pop()!]! };
    } catch {
      throw Errors.notFound('Imagem');
    }
  }
}

/** URL pública da foto (mesma origem, servida pela API). */
export function productImageUrl(key: string | null | undefined): string | null {
  return key ? `/api/v1/public/images/${key}` : null;
}
