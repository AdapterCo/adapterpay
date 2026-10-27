import type { AppConfig } from '../config';

export class WhatsAppError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

type EvolutionConfig = Pick<AppConfig, 'EVOLUTION_API_URL' | 'EVOLUTION_API_KEY' | 'EVOLUTION_INSTANCE'>;

/** URL e chave da Evolution presentes: dá para criar e usar instâncias dos lojistas. */
export function isEvolutionConfigured(config: EvolutionConfig): boolean {
  return !!(config.EVOLUTION_API_URL && config.EVOLUTION_API_KEY && config.EVOLUTION_API_KEY !== 'CHANGE_ME');
}

/** Instância fixa da plataforma configurada (usada só no fechamento de caixa). */
export function isWhatsAppConfigured(config: EvolutionConfig): boolean {
  return isEvolutionConfigured(config) && !!config.EVOLUTION_INSTANCE;
}

/** Nome da instância do lojista na Evolution. Sempre gerado pelo servidor, nunca vem do cliente. */
export function tenantInstanceName(tenantId: string): string {
  return `ap-${tenantId}`;
}

/** Chamada à Evolution API v2. A chave nunca é registrada em log; 404 vira `null`. */
async function evolution<T>(config: EvolutionConfig, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = 15_000): Promise<T | null> {
  if (!isEvolutionConfigured(config)) throw new WhatsAppError('WhatsApp não configurado (EVOLUTION_API_URL/KEY)');
  const url = new URL(path, config.EVOLUTION_API_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { apikey: config.EVOLUTION_API_KEY!, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new WhatsAppError(`Falha de rede na Evolution: ${(err as Error).name}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new WhatsAppError(`Evolution respondeu ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return (await res.json().catch(() => ({}))) as T;
}

async function sendText(config: EvolutionConfig, instance: string, number: string, text: string, timeoutMs: number): Promise<void> {
  if (!/^\d{12,13}$/.test(number)) throw new WhatsAppError('Número de WhatsApp inválido');
  const sent = await evolution(config, 'POST', `/message/sendText/${encodeURIComponent(instance)}`, { number, text }, timeoutMs);
  if (sent === null) throw new WhatsAppError(`Instância ${instance} não existe na Evolution`, 404);
}

/**
 * Envia texto pelo WhatsApp da plataforma (Evolution API v2: POST /message/sendText/{instância}).
 * O número vai só com dígitos e DDI (ex.: 5511987654321).
 */
export async function sendWhatsAppText(config: EvolutionConfig, number: string, text: string, timeoutMs = 15_000): Promise<void> {
  if (!isWhatsAppConfigured(config)) throw new WhatsAppError('WhatsApp não configurado (EVOLUTION_API_URL/KEY/INSTANCE)');
  await sendText(config, config.EVOLUTION_INSTANCE!, number, text, timeoutMs);
}

/** Envia texto pelo WhatsApp conectado do lojista (instância própria). */
export async function sendWhatsAppTextFrom(config: EvolutionConfig, instance: string, number: string, text: string, timeoutMs = 15_000): Promise<void> {
  await sendText(config, instance, number, text, timeoutMs);
}

export type WhatsAppState = 'open' | 'connecting' | 'close' | 'missing';

/** Estado da conexão da instância: open (conectado), connecting (aguardando leitura do QR), close, missing (não existe). */
export async function getWhatsAppState(config: EvolutionConfig, instance: string): Promise<WhatsAppState> {
  const r = await evolution<{ instance?: { state?: string }; state?: string }>(config, 'GET', `/instance/connectionState/${encodeURIComponent(instance)}`);
  if (r === null) return 'missing';
  const state = r.instance?.state ?? r.state;
  return state === 'open' || state === 'connecting' ? state : 'close';
}

/** Número dono da instância (só dígitos), quando a Evolution informa. */
export async function getWhatsAppOwnerNumber(config: EvolutionConfig, instance: string): Promise<string | null> {
  const r = await evolution<Array<{ ownerJid?: string | null; owner?: string | null; instance?: { owner?: string | null } }>>(
    config,
    'GET',
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
  );
  const item = Array.isArray(r) ? r[0] : undefined;
  const jid = item?.ownerJid ?? item?.owner ?? item?.instance?.owner ?? null;
  const digits = jid ? jid.split('@')[0]!.split(':')[0]!.replace(/\D/g, '') : '';
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export interface WhatsAppPairing {
  /** Imagem do QR (data URL), para ler em WhatsApp > Aparelhos conectados */
  qrBase64: string | null;
  /** Código de 8 caracteres para "Conectar com número de telefone", quando pedido */
  pairingCode: string | null;
  /** A instância já estava conectada */
  connected: boolean;
}

/**
 * Cria a instância do lojista (se ainda não existir) e devolve o QR de pareamento.
 * Com `number`, a Evolution também devolve o código de pareamento por número.
 */
export async function connectWhatsApp(config: EvolutionConfig, instance: string, number?: string): Promise<WhatsAppPairing> {
  if ((await getWhatsAppState(config, instance)) === 'missing') {
    try {
      await evolution(config, 'POST', '/instance/create', {
        instanceName: instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
      });
    } catch (err) {
      // Criada em paralelo por outra requisição: segue para o QR.
      if (!(err instanceof WhatsAppError && err.status === 403)) throw err;
    }
  }
  const query = number ? `?number=${encodeURIComponent(number)}` : '';
  const r = await evolution<{ base64?: string; pairingCode?: string | null; instance?: { state?: string } }>(
    config,
    'GET',
    `/instance/connect/${encodeURIComponent(instance)}${query}`,
  );
  if (r === null) throw new WhatsAppError('Instância não encontrada na Evolution', 404);
  return {
    qrBase64: typeof r.base64 === 'string' && r.base64.startsWith('data:image/') ? r.base64 : null,
    pairingCode: typeof r.pairingCode === 'string' ? r.pairingCode : null,
    connected: r.instance?.state === 'open',
  };
}

/** Desconecta o número e apaga a instância do lojista. Instância inexistente não é erro. */
export async function deleteWhatsAppInstance(config: EvolutionConfig, instance: string): Promise<void> {
  await evolution(config, 'DELETE', `/instance/logout/${encodeURIComponent(instance)}`).catch(() => null);
  await evolution(config, 'DELETE', `/instance/delete/${encodeURIComponent(instance)}`);
}
