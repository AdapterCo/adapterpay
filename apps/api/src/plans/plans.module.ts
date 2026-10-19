import { Controller, Get, Inject, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CoreDeps } from '@adapterpay/core';
import { Public } from '../auth/decorators';
import { CORE } from '../common/tokens';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Public()
  @Get()
  async list(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    const plans = await this.deps.prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: p.priceCents,
      maxPos: p.maxPos,
      maxStores: p.maxStores,
      maxUsers: p.maxUsers,
    }));
  }
}

@Module({ controllers: [PlansController] })
export class PlansModule {}
