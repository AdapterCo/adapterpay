import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createUserSchema, updateUserSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { Critical, RequirePermission } from '../auth/decorators';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { ApiZodBody, ZBody } from '../common/zod';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users:manage')
  list(@CurrentAuth() auth: AuthContext) {
    return this.users.list(auth);
  }

  /** Cria o usuário já ativo, com senha inicial definida pelo administrador. */
  @Post()
  @Critical()
  @RequirePermission('users:manage')
  @RateLimit({ key: 'user-create', limit: 30, windowSec: 3600, by: 'user' })
  @ApiZodBody(createUserSchema)
  create(@CurrentAuth() auth: AuthContext, @ZBody(createUserSchema) body: z.infer<typeof createUserSchema>, @Meta() meta: RequestMeta) {
    return this.users.create(auth, body, meta);
  }

  @Patch(':id')
  @Critical()
  @RequirePermission('users:manage')
  @ApiZodBody(updateUserSchema)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(updateUserSchema) body: z.infer<typeof updateUserSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.users.update(auth, id, body, meta);
  }
}
