import { Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CoreDeps } from '@adapterpay/core';
import { Critical, Public, RequirePermission } from '../../auth/decorators';
import { RateLimit } from '../../common/rate-limit';
import { CurrentAuth, Meta, requireTenant, type AppRequest, type AuthContext, type RequestMeta } from '../../common/request';
import { CORE } from '../../common/tokens';
import { MercadoPagoService } from './mercado-pago.service';

@ApiTags('mercado-pago')
@Controller('integrations/mercado-pago')
export class MercadoPagoController {
  constructor(
    private readonly mp: MercadoPagoService,
    @Inject(CORE) private readonly deps: CoreDeps,
  ) {}

  /** Inicia OAuth. Com Accept: application/json retorna a URL; caso contrário redireciona (302). */
  @Get('connect')
  @Critical()
  @RequirePermission('mp:manage')
  @RateLimit({ key: 'mp-connect', limit: 20, windowSec: 600, by: 'user' })
  async connect(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res() res: Response): Promise<void> {
    requireTenant(auth);
    const url = await this.mp.startAuthorization(auth);
    res.setHeader('Cache-Control', 'no-store');
    if ((req.headers.accept ?? '').includes('application/json')) {
      res.json({ authorizationUrl: url });
      return;
    }
    res.redirect(302, url);
  }

  /** Callback cadastrado no app Mercado Pago (URL HTTPS exata em MP_OAUTH_REDIRECT_URI). */
  @Public()
  @Get('callback')
  @RateLimit({ key: 'mp-callback', limit: 30, windowSec: 600 })
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: AppRequest,
    @Meta() meta: RequestMeta,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.mp
      .handleCallback({ code, state, error, auth: req.auth, meta })
      .catch((err: unknown) => {
        this.deps.logger.error({ err: (err as Error).message }, 'erro no callback OAuth');
        return { ok: false as const, error: 'internal' };
      });
    const target = new URL('/app/integracoes/mercado-pago', this.deps.config.APP_URL);
    if (outcome.ok) target.searchParams.set('connected', '1');
    else target.searchParams.set('error', outcome.error);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target.toString());
  }

  @Get('connections')
  @RequirePermission('mp:manage')
  async connections(@CurrentAuth() auth: AuthContext) {
    return this.mp.list(requireTenant(auth));
  }

  @Post('connections/:id/reconnect')
  @Critical()
  @RequirePermission('mp:manage')
  async reconnect(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    requireTenant(auth);
    return { authorizationUrl: await this.mp.startAuthorization(auth, id) };
  }

  @Post('connections/:id/test')
  @RequirePermission('mp:manage')
  @RateLimit({ key: 'mp-test', limit: 10, windowSec: 60, by: 'user' })
  async test(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mp.test(requireTenant(auth), id);
  }

  @Delete('connections/:id')
  @Critical()
  @RequirePermission('mp:manage')
  async disconnect(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('confirm') confirm: string | undefined,
    @Meta() meta: RequestMeta,
  ) {
    requireTenant(auth);
    return this.mp.disconnect(auth, id, confirm === 'true', meta);
  }
}
