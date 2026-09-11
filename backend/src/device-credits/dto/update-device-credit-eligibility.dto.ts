import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDeviceCreditEligibilityDto {
  @ApiProperty({
    description: 'Accorde ou retire les quotas gratuits a cet utilisateur.',
  })
  @IsBoolean()
  eligible: boolean;

  @ApiProperty({ required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reason?: string;
}
