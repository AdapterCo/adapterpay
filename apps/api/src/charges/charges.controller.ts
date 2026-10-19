import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { createChargeSchema, listChargesQuerySchema, type CreateChargeInput } from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { ApiZodBody, ZBody, ZQuery } from '../common/zod';
import { ChargesService } from './charges.service';

@ApiTags('charges')
@Controller('charges')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  /**
   * Cria cobrança (valor definido pelo vendedor e fixado no backend).
   * Erros: 409 POS_BUSY, 422 POS_NOT_ORDER_READY/VALIDATION_FAILED, 403 SUBSCRIPTION_INACTIVE, 502 MP_UPSTREAM_ERROR.
   */
  @Post()
  @HttpCode(201)
  @RequirePermission('charges:create')
  @RateLimit({ key: 'charge-create', limit: 60, windowSec: 60, by: 'user' })
  @ApiZodBody(createChargeSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Repetições com a mesma chave retornam a mesma cobrança' })
  create(
    @CurrentAuth() auth: AuthContext,
    @ZBody(createChargeSchema) body: CreateChargeInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Meta() meta: RequestMeta,
  ) {
    return this.charges.create(auth, body, idempotencyKey, meta);
  }

  @Get()
  @RequirePermission('charges:read')
  list(@CurrentAuth() auth: AuthContext, @ZQuery(listChargesQuerySchema) q: z.infer<typeof listChargesQuerySchema>) {
    return this.charges.list(auth, q);
  }

  @Get(':id')
  @RequirePermission('charges:read')
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.charges.detail(auth, id);
  }

  @Get(':id/status')
  @RequirePermission('charges:read')
  @RateLimit({ key: 'charge-status', limit: 120, windowSec: 60, by: 'user' })
  status(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.charges.status(auth, id);
  }

  @Post(':id/cancel')
  @RequirePermission('charges:cancel')
  @RateLimit({ key: 'charge-cancel', limit: 20, windowSec: 60, by: 'user' })
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.charges.cancel(auth, id, meta);
  }
}
