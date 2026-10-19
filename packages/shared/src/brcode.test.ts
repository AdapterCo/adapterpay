import { describe, expect, it } from 'vitest';
import { crc16ccitt, validateBrCode } from './brcode';

function withCrc(body: string): string {
  const base = `${body}6304`;
  return base + crc16ccitt(base);
}

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

// BR Code sintético (estático) com GUI do Pix, moeda 986 e país BR.
const sample = withCrc(
  tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', '123e4567-e12b-12d1-a456-426655440000')) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('58', 'BR') +
    tlv('59', 'LOJA TESTE') +
    tlv('60', 'SAO PAULO') +
    tlv('62', tlv('05', '***')),
);

describe('validateBrCode', () => {
  it('CRC16 de referência', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });

  it('aceita BR Code Pix íntegro', () => {
    expect(validateBrCode(sample)).toEqual({ valid: true, reasons: [] });
  });

  it('rejeita CRC adulterado', () => {
    const tampered = sample.slice(0, -1) + (sample.endsWith('0') ? '1' : '0');
    expect(validateBrCode(tampered).reasons).toContain('CRC_MISMATCH');
  });

  it('rejeita conteúdo alterado mantendo o CRC antigo', () => {
    const tampered = sample.replace('LOJA TESTE', 'LOJA FALSA');
    expect(validateBrCode(tampered).valid).toBe(false);
  });

  it('rejeita vazio e não-Pix', () => {
    expect(validateBrCode('').valid).toBe(false);
    expect(validateBrCode(null).valid).toBe(false);
    const notPix = withCrc(tlv('00', '01') + tlv('26', tlv('00', 'com.example')) + tlv('53', '986'));
    expect(validateBrCode(notPix).reasons).toContain('NOT_PIX');
  });
});
