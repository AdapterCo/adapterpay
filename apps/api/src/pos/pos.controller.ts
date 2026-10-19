import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createPosSchema, importPosConfirmSchema, importPreviewSchema, updatePosSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { ApiZodBody, ZBody } from '../common/zod';
import { PosService } from './pos.service';

@ApiTags('pos')
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get()
  @RequirePermission('pos:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.pos.list(auth);
  }

  @Post()
  @RequirePermission('pos:manage')
  @RateLimit({ key: 'pos-create', limit: 30, windowSec: 600, by: 'user' })
  @ApiZodBody(createPosSchema)
  create(@CurrentAuth() auth: AuthContext, @ZBody(createPosSchema) body: z.infer<typeof createPosSchema>, @Meta() meta: RequestMeta) {
    return this.pos.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermission('pos:manage')
  @ApiZodBody(updatePosSchema)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(updatePosSchema) body: z.infer<typeof updatePosSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.pos.update(auth, id, body, meta);
  }

  @Post('import/preview')
  @RequirePermission('pos:manage')
  @RateLimit({ key: 'pos-import', limit: 20, windowSec: 600, by: 'user' })
  preview(@CurrentAuth() auth: AuthContext, @ZBody(importPreviewSchema) body: z.infer<typeof importPreviewSchema>) {
    return this.pos.importPreview(auth, body.mpConnectionId);
  }

  @Post('import/confirm')
  @RequirePermission('pos:manage')
  @ApiZodBody(importPosConfirmSchema)
  confirm(@CurrentAuth() auth: AuthContext, @ZBody(importPosConfirmSchema) body: z.infer<typeof importPosConfirmSchema>, @Meta() meta: RequestMeta) {
    return this.pos.importConfirm(auth, body, meta);
  }

  @Post(':id/sync')
  @RequirePermission('pos:manage')
  @RateLimit({ key: 'pos-sync', limit: 30, windowSec: 600, by: 'user' })
  sync(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.pos.sync(auth, id, meta);
  }

  @Post(':id/regularize')
  @RequirePermission('pos:manage')
  regularize(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.pos.regularize(auth, id, meta);
  }

  @Post(':id/deactivate')
  @RequirePermission('pos:manage')
  deactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.pos.deactivate(auth, id, meta);
  }

  @Get(':id/public-qr')
  @RequirePermission('pos:read')
  publicQr(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.pos.publicQr(auth, id);
  }

  @Get(':id/brcode')
  @RequirePermission('pos:read_brcode')
  brCode(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.pos.brCode(auth, id, meta);
  }
}
