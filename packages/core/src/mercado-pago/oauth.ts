import { createHash } from 'node:crypto';
import type { MercadoPagoHttp } from './http';

/**
 * OAuth Mercado Pago (seção 6). Client ID/Secret apenas no backend.
 * Fluxo authorization_code com `state` de uso único; PKCE opcional (MP_OAUTH_PKCE=true quando
 * habilitado no app MP — o valor precisa coincidir com a configuração do app).
 */

export interface MpTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  user_id: number | string;
  refresh_token?: string;
  public_key?: string;
  live_mode?: boolean;
}

export interface MpUserMe {
  id: number | string;
  nickname?: string;
  email?: string;
  site_id?: string;
  first_name?: string;
  last_name?: string;
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizationUrl(params: {
  authBase: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeVerifier?: string;
}): string {
  const url = new URL('/authorization', params.authBase);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', params.state);
  url.searchParams.set('redirect_uri', params.redirectUri);
  if (params.codeVerifier) {
    url.searchParams.set('code_challenge', pkceChallenge(params.codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export async function exchangeAuthorizationCode(
  http: MercadoPagoHttp,
  params: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier?: string },
): Promise<MpTokenResponse> {
  return http.request<MpTokenResponse>({
    method: 'POST',
    path: '/oauth/token',
    body: {
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
    },
  });
}

export async function refreshAccessToken(
  http: MercadoPagoHttp,
  params: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<MpTokenResponse> {
  return http.request<MpTokenResponse>({
    method: 'POST',
    path: '/oauth/token',
    body: {
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
    },
  });
}

export async function getUserMe(http: MercadoPagoHttp, accessToken: string): Promise<MpUserMe> {
  return http.request<MpUserMe>({ method: 'GET', path: '/users/me', accessToken });
}
