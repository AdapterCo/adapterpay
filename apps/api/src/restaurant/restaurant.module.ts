import { Module } from '@nestjs/common';
import { ChargesModule } from '../charges/charges.module';
import { PosModule } from '../pos/pos.module';
import { PublicTablesController } from './public-tables.controller';
import { TablesController } from './tables.controller';

@Module({ imports: [ChargesModule, PosModule], controllers: [TablesController, PublicTablesController] })
export class RestaurantModule {}
