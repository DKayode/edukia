import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AbonnementsService } from './abonnements.service';
import { ConsommerKetsiaDto } from './dto/consommer-ketsia.dto';
import { SouscrireDto } from './dto/souscrire.dto';
import { FeatureQuota } from './entities/quota-consommation.entity';
import { ProfilIncompletException, QuotaDepasseException } from './quota.guard';
import { QuotaService } from './quota.service';
import { EntitlementService, Feature } from './entitlement.service';
import { ParrainageService } from './parrainage.service';
import { PlansService } from './plans.service';

@ApiTags('abonnements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('abonnements')
export class AbonnementsController {
  constructor(
    private readonly abonnementsService: AbonnementsService,
    private readonly plansService: PlansService,
    private readonly entitlement: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly parrainage: ParrainageService,
  ) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Catalogue des plans ouverts',
    description:
      'Ne renvoie que les plans actifs. Tant que l’encaissement (#248) n’est pas livré, ' +
      'la liste est volontairement vide : montrer un prix qu’on ne peut pas payer n’aide personne.',
  })
  plans(@CurrentCountry() pays: string) {
    return this.plansService.findActifs(pays);
  }

  @Get('mon-abonnement')
  @ApiOperation({ summary: 'Abonnement courant (actif, sinon en attente), ou null' })
  monAbonnement(@Request() req) {
    return this.abonnementsService.monAbonnement(req.user?.utilisateurId);
  }

  @Get('mes-abonnements')
  @ApiOperation({ summary: 'Historique des abonnements de l’utilisateur' })
  mesAbonnements(@Request() req, @Query() pagination: PaginationDto) {
    return this.abonnementsService.mesAbonnements(req.user?.utilisateurId, pagination);
  }

  @Get('mes-droits')
  @ApiOperation({
    summary: 'Décision de droit par fonctionnalité',
    description:
      'Permet au client de griser son interface AVANT de se prendre un 403. ' +
      '`verrou_actif` dit si le refus est réellement appliqué ou seulement simulé.',
  })
  @ApiResponse({ status: 200, description: 'Une décision par fonctionnalité + l’état du verrou' })
  async mesDroits(@CurrentCountry() pays: string, @Request() req) {
    return {
      verrou_actif: this.entitlement.verrouActif(pays),
      droits: await this.entitlement.mesDroits(req.user?.utilisateurId, req.user?.role, pays),
    };
  }

  @Get('mes-parrainages')
  @ApiOperation({
    summary: 'Filleuls et commissions perçues',
    description:
      'Liste des filleuls, nombre d’entre eux ayant souscrit, et total des commissions ' +
      'créditées dans le wallet.',
  })
  mesParrainages(@Request() req) {
    return this.parrainage.mesParrainages(req.user?.utilisateurId);
  }

  @Get('mes-quotas')
  @ApiOperation({
    summary: 'Consommation des quotas gratuits',
    description: 'Ressources distinctes déjà consultées et lancements de Ketsia, avec leurs plafonds.',
  })
  mesQuotas(@CurrentCountry() pays: string, @Request() req) {
    return this.quotas.etatPourUtilisateur(req.user?.utilisateurId, pays);
  }

  @Post('quota/ketsia')
  @ApiOperation({
    summary: 'Consommer le quota Ketsia sur une ressource',
    description:
      'À appeler AVANT d’ouvrir l’assistante. Revenir sur une ressource déjà décomptée ' +
      'est toujours autorisé et ne consomme rien. Ce contrôle est un confort d’interface : ' +
      'le contrôle qui fait foi est celui que Kessiah effectue de serveur à serveur.',
  })
  @ApiResponse({ status: 403, description: 'QUOTA_EXCEEDED — quota Ketsia épuisé' })
  async consommerKetsia(
    @CurrentCountry() pays: string,
    @Request() req,
    @Body() dto: ConsommerKetsiaDto,
  ) {
    const utilisateurId = req.user?.utilisateurId;
    const decision = await this.entitlement.check(utilisateurId, Feature.KETSIA_AI, req.user?.role, pays);
    // Profil incomplet : refuser sans consommer le lancement gratuit.
    if (decision.reason === 'PROFIL_INCOMPLET') {
      if (!this.entitlement.verrouActif(pays)) {
        return { allowed: true, reason: 'PROFIL_INCOMPLET', quota: decision.quota, verrou_actif: false };
      }
      throw new ProfilIncompletException(Feature.KETSIA_AI, decision);
    }

    // Aucun plafond applicable (abonné, admin, ou quota désactivé).
    if (decision.allowed && !decision.quota) {
      return { allowed: true, reason: decision.reason };
    }

    const resultat = await this.quotas.consommer(
      utilisateurId, FeatureQuota.KETSIA_AI, dto.resource_type, dto.resource_id, pays,
    );
    if (resultat.allowed) {
      return { allowed: true, reason: 'FREE_QUOTA', quota: { used: resultat.used, limit: resultat.limit } };
    }
    if (!this.entitlement.verrouActif(pays)) {
      return { allowed: true, reason: 'FREE_QUOTA', quota: { used: resultat.used, limit: resultat.limit }, verrou_actif: false };
    }
    throw new QuotaDepasseException(Feature.KETSIA_AI, resultat);
  }

  @Post('souscrire')
  @ApiOperation({
    summary: 'Ouvrir un abonnement',
    description:
      'Crée un abonnement EN_ATTENTE. Il devient ACTIF au paiement (#248) ou par ' +
      'activation manuelle d’un administrateur.',
  })
  souscrire(@CurrentCountry() pays: string, @Request() req, @Body() dto: SouscrireDto) {
    return this.abonnementsService.souscrire(pays, req.user?.utilisateurId, dto);
  }
}
