import type { AppConfig } from '../config';

export class WhatsAppError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

type EvolutionConfig = Pick<AppConfig, 'EVOLUTION_API_URL' | 'EVOLUTION_API_KEY' | 'EVOLUTION_INSTANCE'>;

export function isWhatsAppConfigured(config: EvolutionConfig): boolean {
  return !!(config.EVOLUTION_API_URL && config.EVOLUTION_API_KEY && config.EVOLUTION_API_KEY !== 'CHANGE_ME' && config.EVOLUTION_INSTANCE);
}

/**
 * Envia texto pelo WhatsApp da plataforma (Evolution API v2: POST /message/sendText/{instância}).
 * O número vai só com dígitos e DDI (ex.: 5511987654321). A chave nunca é registrada em log.
 */
export async function sendWhatsAppText(config: EvolutionConfig, number: string, text: string, timeoutMs = 15_000): Promise<void> {
  if (!isWhatsAppConfigured(config)) throw new WhatsAppError('WhatsApp não configurado (EVOLUTION_API_URL/KEY/INSTANCE)');
  if (!/^\d{12,13}$/.test(number)) throw new WhatsAppError('Número de WhatsApp inválido');
  const url = new URL(`/message/sendText/${encodeURIComponent(config.EVOLUTION_INSTANCE!)}`, config.EVOLUTION_API_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.EVOLUTION_API_KEY! },
      body: JSON.stringify({ number, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new WhatsAppError(`Falha de rede ao enviar WhatsApp: ${(err as Error).name}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new WhatsAppError(`Evolution respondeu ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
}
