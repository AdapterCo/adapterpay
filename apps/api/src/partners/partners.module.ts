import { Module } from '@nestjs/common';
import { AdminPartnersController } from './admin-partners.controller';
import { PublicPartnersController } from './public-partners.controller';

@Module({ controllers: [PublicPartnersController, AdminPartnersController] })
export class PartnersModule {}
