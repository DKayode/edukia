import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum DeviceAttestationProvider {
  ANDROID_PLAY_INTEGRITY = 'ANDROID_PLAY_INTEGRITY',
  IOS_DEVICECHECK = 'IOS_DEVICECHECK',
}

export class DeviceAttestationDto {
  @ApiProperty({ enum: DeviceAttestationProvider })
  @IsEnum(DeviceAttestationProvider)
  provider: DeviceAttestationProvider;

  @ApiProperty({
    example: 'a52ed8ef-b84c-4262-95a8-0da2f105c78f',
    description: 'UUID v4 stable pendant la vie de cette installation.',
  })
  @IsUUID('4')
  installation_id: string;

  @ApiProperty({
    description: 'Jeton Play Integrity ou DeviceCheck genere par le SDK natif.',
  })
  @IsString()
  @MinLength(16)
  @MaxLength(20000)
  token: string;
}
