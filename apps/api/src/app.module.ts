import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/csrf.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ChargesModule } from './charges/charges.module';
import { CoreModule } from './common/core.module';
import { RateLimitGuard } from './common/rate-limit';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { MercadoPagoModule } from './integrations/mercado-pago/mercado-pago.module';
import { PlansModule } from './plans/plans.module';
import { PosModule } from './pos/pos.module';
import { ProductsModule } from './products/products.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { PublicModule } from './public/public.module';
import { ReportsModule } from './reports/reports.module';
import { StoresModule } from './stores/stores.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    TenantsModule,
    PlansModule,
    SubscriptionsModule,
    MercadoPagoModule,
    StoresModule,
    PosModule,
    ChargesModule,
    ProductsModule,
    LoyaltyModule,
    PublicModule,
    EventsModule,
    ReportsModule,
    UsersModule,
    AuditModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    // Ordem: rate limit -> autenticação -> CSRF -> permissões.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
