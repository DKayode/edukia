import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';
import { DeviceCreditEligibilityService } from './device-credit-eligibility.service';
import { UpdateDeviceCreditEligibilityDto } from './dto/update-device-credit-eligibility.dto';

@ApiTags('appareils-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleType.ADMIN)
@Controller('admin/appareils/quotas-gratuits')
export class DeviceCreditsAdminController {
  constructor(private readonly deviceCredits: DeviceCreditEligibilityService) {}

  @Get()
  @ApiOperation({
    summary:
      'Appareils ayant cree plusieurs comptes eligibles au quota gratuit',
  })
  @ApiQuery({ name: 'minimum', required: false, type: Number, example: 3 })
  list(@Query('minimum') minimum?: string) {
    return this.deviceCredits.listForAdmin(Number(minimum ?? 3));
  }

  @Patch('utilisateurs/:utilisateurId')
  @ApiOperation({
    summary: 'Accorder ou retirer manuellement les quotas gratuits',
  })
  updateEligibility(
    @Param('utilisateurId', ParseIntPipe) utilisateurId: number,
    @Request() req,
    @Body() dto: UpdateDeviceCreditEligibilityDto,
  ) {
    return this.deviceCredits.overrideForAdmin(
      utilisateurId,
      req.user.utilisateurId,
      dto.eligible,
      dto.reason,
    );
  }
}
