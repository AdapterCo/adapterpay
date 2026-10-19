/**
 * Validação estrutural do BR Code (EMV QRCPS-MPM) retornado em qr_response.qr_code do POS.
 * Não altera o código — apenas confirma integridade (CRC16) e que é um Pix, para detectar
 * códigos corrompidos/adulterados antes de exibi-los na página pública (seção 15).
 */

export interface EmvField {
  id: string;
  value: string;
}

export function parseEmv(payload: string): EmvField[] | null {
  const out: EmvField[] = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) return null;
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len)) return null;
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out.push({ id, value });
    i += 4 + len;
  }
  return out;
}

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF), como exigido pelo padrão EMV. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface BrCodeValidation {
  valid: boolean;
  reasons: string[];
}

export function validateBrCode(code: string | null | undefined): BrCodeValidation {
  const reasons: string[] = [];
  if (!code || typeof code !== 'string') return { valid: false, reasons: ['EMPTY'] };
  if (code.length > 512) reasons.push('TOO_LONG');
  if (!code.startsWith('000201')) reasons.push('INVALID_PAYLOAD_FORMAT');
  const crcIdx = code.length - 8;
  if (crcIdx < 0 || code.slice(crcIdx, crcIdx + 4) !== '6304') {
    reasons.push('MISSING_CRC');
  } else {
    const expected = crc16ccitt(code.slice(0, crcIdx + 4));
    if (code.slice(crcIdx + 4).toUpperCase() !== expected) reasons.push('CRC_MISMATCH');
  }
  const fields = parseEmv(code);
  if (!fields) {
    reasons.push('INVALID_TLV');
  } else {
    const merchant = fields.find((f) => Number(f.id) >= 26 && Number(f.id) <= 51 && /br\.gov\.bcb\.pix/i.test(f.value));
    if (!merchant) reasons.push('NOT_PIX');
    const currency = fields.find((f) => f.id === '53');
    if (currency && currency.value !== '986') reasons.push('CURRENCY_NOT_BRL');
  }
  return { valid: reasons.length === 0, reasons };
}
