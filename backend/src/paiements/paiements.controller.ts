import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ConfirmerTransactionMobileDto } from './dto/confirmer-transaction-mobile.dto';
import { InitierPaiementDto } from './dto/initier-paiement.dto';
import { ListePrestatairesDisponiblesDto } from './dto/prestataire-disponible.dto';
import { PaiementVerificationRateLimitGuard } from './paiement-verification-rate-limit.guard';
import { PaiementsService } from './paiements.service';

@ApiTags('paiements')
@Controller('paiements')
export class PaiementsController {
  constructor(private readonly paiements: PaiementsService) {}

  @Get('prestataires')
  @ApiOperation({ summary: 'Lister les prestataires de paiement disponibles dans un pays' })
  @ApiOkResponse({ type: ListePrestatairesDisponiblesDto })
  prestataires(@CurrentCountry() pays: string) {
    return this.paiements.prestatairesDisponibles(pays);
  }

  @Post('initier')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Initier le paiement d’un abonnement en attente' })
  initier(@CurrentCountry() pays: string, @Request() req, @Body() dto: InitierPaiementDto) {
    return this.paiements.initier(pays, req.user?.utilisateurId, dto);
  }

  @Get('mes-paiements')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Historique des paiements de l’utilisateur' })
  mesPaiements(@CurrentCountry() pays: string, @Request() req, @Query() pagination: PaginationDto) {
    return this.paiements.mesPaiements(pays, req.user?.utilisateurId, pagination);
  }

  @Get(':uuid')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Statut d’un paiement pour polling mobile' })
  findOne(@CurrentCountry() pays: string, @Request() req, @Param('uuid') uuid: string) {
    return this.paiements.findOne(pays, req.user?.utilisateurId, uuid);
  }

  @Post(':uuid/verifier')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PaiementVerificationRateLimitGuard)
  @Throttle({ 'paiements-burst': {}, 'paiements-hourly': {} })
  @ApiOperation({
    summary: 'Interroger le prestataire maintenant et appliquer le résultat',
    description:
      'À appeler au retour de la page de paiement. Renvoie l’état du paiement et, le cas '
      + 'échéant, celui de l’abonnement ou de la commande qu’il a débloqués.',
  })
  verifier(@CurrentCountry() pays: string, @Request() req, @Param('uuid') uuid: string) {
    return this.paiements.verifierMaintenant(pays, req.user?.utilisateurId, uuid);
  }

  @Post(':uuid/transaction-prestataire')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Associer et vérifier la transaction renvoyée par un SDK mobile' })
  confirmerTransactionMobile(
    @CurrentCountry() pays: string,
    @Request() req,
    @Param('uuid') uuid: string,
    @Body() dto: ConfirmerTransactionMobileDto,
  ) {
    return this.paiements.confirmerTransactionMobile(pays, req.user?.utilisateurId, uuid, dto);
  }
}
