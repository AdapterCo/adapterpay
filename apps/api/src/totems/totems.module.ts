import { Module } from '@nestjs/common';
import { ChargesModule } from '../charges/charges.module';
import { OrdersController } from './orders.controller';
import { TotemDeviceController } from './totem-device.controller';
import { TotemsController } from './totems.controller';

@Module({ imports: [ChargesModule], controllers: [TotemsController, TotemDeviceController, OrdersController] })
export class TotemsModule {}
