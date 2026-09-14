import { Module } from '@nestjs/common';
import { AbonnementsModule } from '../abonnements/abonnements.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AbonnementsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
