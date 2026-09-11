import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtOptionnelGuard } from '../auth/guards/jwt-optionnel.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { CodeValidationRateLimitGuard } from './code-validation-rate-limit.guard';
import { CodeValidationService } from './code-validation.service';
import { ValiderCodeDto } from './dto/valider-code.dto';
import { PlansService } from '../abonnements/plans.service';

@ApiTags('codes')
@Controller('codes')
export class CodesController {
  constructor(
    private readonly validation: CodeValidationService,
    private readonly plans: PlansService,
  ) {}

  @Post('valider')
  // Authentification facultative : on saisit souvent un code promotionnel avant
  // d'avoir un compte. Le jeton, s'il est fourni, sert uniquement à affiner la
  // réponse — il n'est jamais exigé.
  @UseGuards(JwtOptionnelGuard, CodeValidationRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Vérifier un code et calculer la remise, sans le consommer',
    description:
      'Ouvert sans compte : un code se saisit souvent avant l’inscription. Le jeton est ' +
      'facultatif et ne sert qu’à affiner la réponse — sans lui, deux refus ne peuvent pas ' +
      'être détectés : l’usage de son propre code et un code déjà consommé par ce compte. ' +
      'Sans conséquence : le code est de toute façon revalidé sous verrou au moment de la ' +
      'souscription, qui exige un compte. Entre l’aperçu et l’achat, un autre acheteur peut ' +
      'aussi avoir pris la dernière place.',
  })
  @ApiResponse({
    status: 201,
    description: 'Toujours 201 : un code refusé n’est pas une erreur HTTP',
  })
  @ApiResponse({
    status: 429,
    description: 'Trop de tentatives — comptées par compte si connecté, par adresse IP sinon',
  })
  async valider(
    @CurrentCountry() pays: string,
    @Request() req,
    @Body() dto: ValiderCodeDto,
  ) {
    const plan = dto.plan_uuid
      ? await this.plans.findByUuid(dto.plan_uuid).catch(() => null)
      : null;
    return this.validation.valider(dto.code, req.user?.utilisateurId, {
      planId: plan?.id,
      prix: plan?.prix,
      pays,
    });
  }
}
