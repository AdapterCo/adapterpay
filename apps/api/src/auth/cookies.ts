import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '@adapterpay/core';

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const SESSION_IDLE_MS = 12 * 3600 * 1000;

/** Em produção usa o prefixo __Host- (exige Secure, Path=/ e sem Domain). */
export function cookieNames(config: AppConfig): { session: string; csrf: string } {
  const prod = config.NODE_ENV === 'production';
  return { session: prod ? '__Host-ap_session' : 'ap_session', csrf: prod ? '__Host-ap_csrf' : 'ap_csrf' };
}

function base(config: AppConfig): CookieOptions {
  return { secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(cookieNames(config).session, token, { ...base(config), httpOnly: true, maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(cookieNames(config).session, { ...base(config), httpOnly: true });
}

/** Cookie CSRF (double submit): legível pelo frontend, enviado de volta no header X-CSRF-Token. */
export function setCsrfCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(cookieNames(config).csrf, token, { ...base(config), httpOnly: false, maxAge: SESSION_TTL_MS });
}
