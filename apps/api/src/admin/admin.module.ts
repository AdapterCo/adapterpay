import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { OperationsService } from './operations.service';

@Module({ controllers: [AdminController], providers: [OperationsService], exports: [OperationsService] })
export class AdminModule {}
