import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsHub } from './events-hub.service';

@Global()
@Module({ controllers: [EventsController], providers: [EventsHub], exports: [EventsHub] })
export class EventsModule {}
