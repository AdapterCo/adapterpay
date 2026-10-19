import { Controller, Get, Header, type MessageEvent, Param, Req, Res, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { channels } from '@adapterpay/core';
import { ERROR_CODES } from '@adapterpay/shared';
import { Public } from '../auth/decorators';
import { AppError } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import type { AppRequest } from '../common/request';
import { EventsHub } from '../events/events-hub.service';
import { PublicService } from './public.service';

const MAX_STREAM_MS = 5 * 60 * 1000;
const REFRESH_MS = 5_000;

@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly svc: PublicService,
    private readonly hub: EventsHub,
  ) {}

  @Get('pos/:publicSlug')
  @RateLimit({ key: 'pub-pos', limit: 120, windowSec: 60 })
  async pos(@Param('publicSlug') slug: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return (await this.svc.posView(slug)).view;
  }

  @Get('charges/:publicToken')
  @RateLimit({ key: 'pub-charge', limit: 120, windowSec: 60 })
  async charge(@Param('publicToken') token: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return (await this.svc.chargeView(token)).view;
  }

  @Sse('pos/:publicSlug/events')
  @RateLimit({ key: 'pub-sse', limit: 60, windowSec: 60 })
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  async posEvents(@Param('publicSlug') slug: string, @Req() req: AppRequest): Promise<Observable<MessageEvent>> {
    const { posId } = await this.svc.posView(slug);
    return this.stream(req, channels.pos(posId), async () => (await this.svc.posView(slug)).view);
  }

  @Sse('charges/:publicToken/events')
  @RateLimit({ key: 'pub-sse', limit: 60, windowSec: 60 })
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  async chargeEvents(@Param('publicToken') token: string, @Req() req: AppRequest): Promise<Observable<MessageEvent>> {
    const { posId } = await this.svc.chargeView(token);
    return this.stream(req, channels.pos(posId), async () => (await this.svc.chargeView(token)).view);
  }

  /** Envia a visão segura inicial e a cada evento/intervalo; nunca repassa o payload interno. */
  private async stream(req: AppRequest, channel: string, build: () => Promise<unknown>): Promise<Observable<MessageEvent>> {
    const release = await this.hub.acquireSlot(`ip:${req.ip ?? 'unknown'}`, 20);
    if (!release) throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Muitas conexões abertas');
    return new Observable<MessageEvent>((subscriber) => {
      let last = '';
      let closed = false;
      const push = async () => {
        if (closed) return;
        try {
          const view = await build();
          const json = JSON.stringify(view);
          if (json !== last) {
            last = json;
            subscriber.next({ type: 'state', data: view as object });
          }
        } catch {
          subscriber.complete();
        }
      };
      void push();
      const unsubscribe = this.hub.subscribe(channel, () => void push());
      const refresh = setInterval(() => void push(), REFRESH_MS);
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: String(Date.now()) }), 15_000);
      const timeout = setTimeout(() => subscriber.complete(), MAX_STREAM_MS);
      return () => {
        closed = true;
        clearInterval(refresh);
        clearInterval(heartbeat);
        clearTimeout(timeout);
        unsubscribe();
        release();
      };
    });
  }
}
