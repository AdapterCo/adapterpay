import type { MercadoPagoHttp } from './http';

/**
 * Lojas e POS no Mercado Pago.
 *
 * COMPROVADO pelo usuário: GET /v2/pos/{id} (campos listados na seção 7) e a existência de POST /pos.
 * A VALIDAR (seção 20, item 1): corpo de POST /pos, endpoints de loja (/users/{id}/stores),
 * busca paginada de POS (GET /pos) e atualização (PUT /pos/{id}) em contas de terceiros via OAuth.
 * Os formatos abaixo seguem a documentação pública do modelo QR presencial e estão isolados aqui
 * para serem ajustados pelos testes de contrato (docs/mercado-pago.md) sem tocar no restante.
 */

export interface MpPosV2 {
  id: number | string;
  name?: string;
  status?: string;
  user_id?: number | string;
  store_id?: number | string;
  external_store_id?: string;
  external_id?: string;
  config?: { qr?: { operating_mode?: string } };
  qr_response?: {
    uuid?: string;
    image?: string;
    template_document?: string;
    template_image?: string;
    qr_code?: string;
  };
}

export interface MpPosListItem {
  id: number | string;
  name?: string;
  status?: string;
  store_id?: number | string;
  external_store_id?: string;
  external_id?: string;
  fixed_amount?: boolean;
  category?: number;
  qr?: { image?: string; template_document?: string; template_image?: string };
}

export interface MpPaged<T> {
  paging?: { total?: number; offset?: number; limit?: number };
  results?: T[];
}

export interface MpStore {
  id: number | string;
  name?: string;
  external_id?: string;
  location?: Record<string, unknown>;
  date_creation?: string;
}

export interface CreatePosBody {
  name: string;
  fixed_amount: boolean;
  store_id?: number;
  external_store_id?: string;
  external_id: string;
  category?: number;
}

export interface CreateStoreBody {
  name: string;
  external_id: string;
  location: {
    street_number: string;
    street_name: string;
    city_name: string;
    state_name: string;
    latitude?: number;
    longitude?: number;
    reference?: string;
  };
}

export async function getPosV2(http: MercadoPagoHttp, accessToken: string, posId: string): Promise<MpPosV2> {
  if (!/^\d{1,20}$/.test(posId)) throw new Error('pos_id inválido');
  return http.request<MpPosV2>({ method: 'GET', path: `/v2/pos/${posId}`, accessToken });
}

export async function createPos(
  http: MercadoPagoHttp,
  accessToken: string,
  body: CreatePosBody,
  idempotencyKey: string,
): Promise<MpPosListItem> {
  return http.request<MpPosListItem>({ method: 'POST', path: '/pos', accessToken, body, idempotencyKey });
}

export async function updatePos(
  http: MercadoPagoHttp,
  accessToken: string,
  posId: string,
  body: Partial<Pick<CreatePosBody, 'name' | 'external_id' | 'category' | 'external_store_id' | 'store_id'>>,
): Promise<MpPosListItem> {
  if (!/^\d{1,20}$/.test(posId)) throw new Error('pos_id inválido');
  return http.request<MpPosListItem>({ method: 'PUT', path: `/pos/${posId}`, accessToken, body });
}

export async function searchPos(
  http: MercadoPagoHttp,
  accessToken: string,
  params: { storeId?: string; externalId?: string; offset: number; limit: number },
): Promise<MpPaged<MpPosListItem>> {
  return http.request<MpPaged<MpPosListItem>>({
    method: 'GET',
    path: '/pos',
    accessToken,
    query: { store_id: params.storeId, external_id: params.externalId, offset: params.offset, limit: params.limit },
  });
}

export async function createStore(
  http: MercadoPagoHttp,
  accessToken: string,
  mpUserId: string,
  body: CreateStoreBody,
  idempotencyKey: string,
): Promise<MpStore> {
  if (!/^\d{1,20}$/.test(mpUserId)) throw new Error('user_id inválido');
  return http.request<MpStore>({
    method: 'POST',
    path: `/users/${mpUserId}/stores`,
    accessToken,
    body,
    idempotencyKey,
  });
}

export async function searchStores(
  http: MercadoPagoHttp,
  accessToken: string,
  mpUserId: string,
  params: { offset: number; limit: number },
): Promise<MpPaged<MpStore>> {
  if (!/^\d{1,20}$/.test(mpUserId)) throw new Error('user_id inválido');
  return http.request<MpPaged<MpStore>>({
    method: 'GET',
    path: `/users/${mpUserId}/stores/search`,
    accessToken,
    query: { offset: params.offset, limit: params.limit },
  });
}

/** Itera todas as páginas de um endpoint paginado, com teto de segurança. */
export async function collectAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<MpPaged<T>>,
  limit = 50,
  maxItems = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    const results = page.results ?? [];
    out.push(...results);
    const total = page.paging?.total ?? out.length;
    offset += results.length;
    if (results.length === 0 || offset >= total || out.length >= maxItems) break;
  }
  return out;
}

/** external_id válido para Orders: alfanumérico, sem espaços, até 40 caracteres (regra conservadora). */
export function isValidExternalPosId(value: string | null | undefined): value is string {
  return !!value && /^[A-Za-z0-9]{1,40}$/.test(value);
}
