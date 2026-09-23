import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
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
import { CodesService } from './codes.service';
import { CommandesCodesService } from './commandes-codes.service';
import { CreerCommandeCodesDto } from './dto/creer-commande-codes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('codes')
@Controller('codes')
export class CodesController {
  constructor(
    private readonly validation: CodeValidationService,
    private readonly plans: PlansService,
    private readonly codesService: CodesService,
    private readonly commandes: CommandesCodesService,
  ) {}


  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('mes-codes')
  @ApiOperation({
    summary: 'Mes codes et leur état',
    description:
      'Les codes que l’utilisateur possède — achetés ou reçus — avec, pour chacun, s’il a été ' +
      'utilisé, quand et par qui. L’état vient du journal des utilisations, pas d’un compteur.',
  })
  mesCodes(@CurrentCountry() pays: string, @Request() req) {
    return this.codesService.mesCodes(req.user?.utilisateurId, pays);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('commandes')
  @ApiOperation({
    summary: 'Acheter plusieurs abonnements d’un coup',
    description:
      'Enregistre l’intention d’achat et renvoie le montant à payer. AUCUN code n’est créé ici : ' +
      'ils naissent à la confirmation du paiement, sans quoi un panier abandonné laisserait des ' +
      'abonnements gratuits dans la nature. Enchaînez avec POST /paiements/initier.',
  })
  creerCommande(
    @CurrentCountry() pays: string,
    @Request() req,
    @Body() dto: CreerCommandeCodesDto,
  ) {
    return this.commandes.creer(pays, req.user?.utilisateurId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('commandes')
  @ApiOperation({ summary: 'Mes commandes groupées et leur état' })
  mesCommandes(@CurrentCountry() pays: string, @Request() req) {
    return this.commandes.mesCommandes(req.user?.utilisateurId, pays);
  }

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
