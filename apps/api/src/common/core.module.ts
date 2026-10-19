import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { BillingService, createCoreDeps, type CoreDeps } from '@adapterpay/core';
import { MailerService } from './mailer.service';
import { QueueService } from './queue.service';
import { CORE } from './tokens';
import { RateLimitService } from './rate-limit';

export { CORE };

@Injectable()
class CoreLifecycle implements OnApplicationShutdown {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  async onApplicationShutdown(): Promise<void> {
    await this.deps.prisma.$disconnect().catch(() => undefined);
    this.deps.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    { provide: CORE, useFactory: () => createCoreDeps('adapterpay-api') },
    { provide: BillingService, useFactory: (deps: CoreDeps) => new BillingService(deps), inject: [CORE] },
    CoreLifecycle,
    MailerService,
    QueueService,
    RateLimitService,
  ],
  exports: [CORE, BillingService, MailerService, QueueService, RateLimitService],
})
export class CoreModule {}
