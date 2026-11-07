import { Module } from '@nestjs/common';
import { PaymentLinksController } from './payment-links.controller';
import { PublicPaymentLinksController } from './public-payment-links.controller';

@Module({ controllers: [PaymentLinksController, PublicPaymentLinksController] })
export class PaymentLinksModule {}
