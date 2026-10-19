import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createStoreSchema, importPreviewSchema, importStoresConfirmSchema, updateStoreSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { ApiZodBody, ZBody } from '../common/zod';
import { StoresService } from './stores.service';

@ApiTags('stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @RequirePermission('stores:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.stores.list(auth);
  }

  @Post()
  @RequirePermission('stores:manage')
  @ApiZodBody(createStoreSchema)
  create(@CurrentAuth() auth: AuthContext, @ZBody(createStoreSchema) body: z.infer<typeof createStoreSchema>, @Meta() meta: RequestMeta) {
    return this.stores.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermission('stores:manage')
  @ApiZodBody(updateStoreSchema)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(updateStoreSchema) body: z.infer<typeof updateStoreSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.stores.update(auth, id, body, meta);
  }

  @Post('import/preview')
  @RequirePermission('stores:manage')
  @RateLimit({ key: 'store-import', limit: 20, windowSec: 600, by: 'user' })
  preview(@CurrentAuth() auth: AuthContext, @ZBody(importPreviewSchema) body: z.infer<typeof importPreviewSchema>) {
    return this.stores.importPreview(auth, body.mpConnectionId);
  }

  @Post('import/confirm')
  @RequirePermission('stores:manage')
  @ApiZodBody(importStoresConfirmSchema)
  confirm(@CurrentAuth() auth: AuthContext, @ZBody(importStoresConfirmSchema) body: z.infer<typeof importStoresConfirmSchema>, @Meta() meta: RequestMeta) {
    return this.stores.importConfirm(auth, body, meta);
  }

  @Post(':id/sync')
  @RequirePermission('stores:manage')
  @RateLimit({ key: 'store-sync', limit: 20, windowSec: 600, by: 'user' })
  sync(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.stores.sync(auth, id, meta);
  }
}
