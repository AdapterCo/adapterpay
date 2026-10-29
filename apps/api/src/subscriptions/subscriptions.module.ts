import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { SubscriptionsController } from './subscriptions.controller';

@Module({ controllers: [SubscriptionsController, ReferralsController] })
export class SubscriptionsModule {}
