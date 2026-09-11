import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AndroidPlayIntegrityProvider } from './android-play-integrity.provider';
import { AppleDeviceCheckProvider } from './apple-device-check.provider';
import { DeviceCreditEligibilityService } from './device-credit-eligibility.service';
import { DeviceCreditsAdminController } from './device-credits-admin.controller';
import { DeviceCreditEligibility } from './entities/device-credit-eligibility.entity';
import { DeviceCreditInstallation } from './entities/device-credit-installation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeviceCreditInstallation,
      DeviceCreditEligibility,
    ]),
  ],
  controllers: [DeviceCreditsAdminController],
  providers: [
    AndroidPlayIntegrityProvider,
    AppleDeviceCheckProvider,
    DeviceCreditEligibilityService,
  ],
  exports: [DeviceCreditEligibilityService],
})
export class DeviceCreditsModule {}
