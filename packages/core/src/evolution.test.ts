import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWhatsApp, getWhatsAppOwnerNumber, getWhatsAppState, sendWhatsAppText, sendWhatsAppTextFrom, tenantInstanceName } from './whatsapp/evolution';

const config = { EVOLUTION_API_URL: 'https://evo.example.test', EVOLUTION_API_KEY: 'k', EVOLUTION_INSTANCE: 'plataforma' };

/** fetch simulado: responde por "MÉTODO caminho" e registra as chamadas. */
function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    const key = `${init.method} ${url.pathname}${url.search}`;
    calls.push(key);
    const r = routes[key] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('WhatsApp do lojista (Evolution)', () => {
  const inst = tenantInstanceName('t1');

  it('estado: open, connecting, close e instância inexistente', async () => {
    mockFetch({ [`GET /instance/connectionState/${inst}`]: { body: { instance: { state: 'open' } } } });
    expect(await getWhatsAppState(config, inst)).toBe('open');
    mockFetch({ [`GET /instance/connectionState/${inst}`]: { body: { instance: { state: 'connecting' } } } });
    expect(await getWhatsAppState(config, inst)).toBe('connecting');
    mockFetch({ [`GET /instance/connectionState/${inst}`]: { body: { instance: { state: 'close' } } } });
    expect(await getWhatsAppState(config, inst)).toBe('close');
    mockFetch({});
    expect(await getWhatsAppState(config, inst)).toBe('missing');
  });

  it('número do dono vem do ownerJid (com ou sem sufixo de aparelho)', async () => {
    mockFetch({ [`GET /instance/fetchInstances?instanceName=${inst}`]: { body: [{ ownerJid: '5511987654321:12@s.whatsapp.net' }] } });
    expect(await getWhatsAppOwnerNumber(config, inst)).toBe('5511987654321');
    mockFetch({ [`GET /instance/fetchInstances?instanceName=${inst}`]: { body: [{ instance: { owner: '5521912345678@s.whatsapp.net' } }] } });
    expect(await getWhatsAppOwnerNumber(config, inst)).toBe('5521912345678');
  });

  it('conectar cria a instância quando não existe e devolve o QR', async () => {
    const calls = mockFetch({
      'POST /instance/create': { status: 201, body: {} },
      [`GET /instance/connect/${inst}`]: { body: { base64: 'data:image/png;base64,AAA', pairingCode: null } },
    });
    const p = await connectWhatsApp(config, inst);
    expect(calls).toEqual([`GET /instance/connectionState/${inst}`, 'POST /instance/create', `GET /instance/connect/${inst}`]);
    expect(p).toEqual({ qrBase64: 'data:image/png;base64,AAA', pairingCode: null, connected: false });
  });

  it('conectar com número pede o código de pareamento sem recriar a instância', async () => {
    const calls = mockFetch({
      [`GET /instance/connectionState/${inst}`]: { body: { instance: { state: 'close' } } },
      [`GET /instance/connect/${inst}?number=5511987654321`]: { body: { base64: 'data:image/png;base64,AAA', pairingCode: 'WZYEH1YY' } },
    });
    const p = await connectWhatsApp(config, inst, '5511987654321');
    expect(calls).not.toContain('POST /instance/create');
    expect(p.pairingCode).toBe('WZYEH1YY');
  });

  it('cashback sai da instância do lojista; fechamento sai da instância da plataforma', async () => {
    const calls = mockFetch({ [`POST /message/sendText/${inst}`]: { status: 201 }, 'POST /message/sendText/plataforma': { status: 201 } });
    await sendWhatsAppTextFrom(config, inst, '5511987654321', 'oi');
    await sendWhatsAppText(config, '5511987654321', 'fechamento');
    expect(calls).toEqual([`POST /message/sendText/${inst}`, 'POST /message/sendText/plataforma']);
  });

  it('envio para instância apagada é erro (não some em silêncio)', async () => {
    mockFetch({});
    await expect(sendWhatsAppTextFrom(config, inst, '5511987654321', 'oi')).rejects.toThrow(/não existe/);
  });
});
