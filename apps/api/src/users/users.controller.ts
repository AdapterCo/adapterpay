import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { inviteUserSchema, passwordSchema, updateUserSchema } from '@adapterpay/shared';
import { z } from 'zod';
import { Critical, Public, RequirePermission } from '../auth/decorators';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { ApiZodBody, ZBody } from '../common/zod';
import { UsersService } from './users.service';

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(120).optional(),
  password: passwordSchema.optional(),
});

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users:manage')
  list(@CurrentAuth() auth: AuthContext) {
    return this.users.list(auth);
  }

  @Post('invite')
  @Critical()
  @RequirePermission('users:manage')
  @RateLimit({ key: 'invite', limit: 30, windowSec: 3600, by: 'user' })
  @ApiZodBody(inviteUserSchema)
  invite(@CurrentAuth() auth: AuthContext, @ZBody(inviteUserSchema) body: z.infer<typeof inviteUserSchema>, @Meta() meta: RequestMeta) {
    return this.users.invite(auth, body, meta);
  }

  @Public()
  @Post('accept-invite')
  @RateLimit({ key: 'accept-invite', limit: 10, windowSec: 600 })
  accept(@ZBody(acceptSchema) body: z.infer<typeof acceptSchema>, @Meta() meta: RequestMeta) {
    return this.users.acceptInvite(body, meta);
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
