import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';
import { AbonnementsService } from './abonnements.service';
import { ActiverAbonnementDto } from './dto/activer-abonnement.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { FilterAbonnementDto } from './dto/filter-abonnement.dto';
import { ProlongerAbonnementDto } from './dto/prolonger-abonnement.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';
import { ParrainageService } from './parrainage.service';
import { QuotaService } from './quota.service';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { ClassementCommissionsDto } from './dto/classement-commissions.dto';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { VerrouService } from './verrou.service';
import { UpdateVerrouDto } from './dto/update-verrou.dto';

@ApiTags('abonnements-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleType.ADMIN)
@Controller('admin/abonnements')
export class AbonnementsAdminController {
  constructor(
    private readonly abonnementsService: AbonnementsService,
    private readonly plansService: PlansService,
    private readonly quotas: QuotaService,
    private readonly parrainage: ParrainageService,
    private readonly verrou: VerrouService,
  ) {}

  // ── Verrou d'accès ───────────────────────────────────────────────────────

  @Get('verrou')
  @ApiOperation({
    summary: 'État du verrou d’accès',
    description:
      'Éteint, les refus sont calculés et journalisés mais la ressource est servie. ' +
      'Allumé, ils s’appliquent. `origine` dit si la valeur vient d’une bascule ' +
      'enregistrée ou, à défaut, de la configuration de déploiement.',
  })
  etatVerrou(@CurrentCountry() pays: string) {
    return this.verrou.etat(pays);
  }

  @Put('verrou')
  @ApiOperation({
    summary: 'Allumer ou éteindre le verrou',
    description:
      'Prend effet immédiatement, sans déploiement. C’est le seul interrupteur qui refuse ' +
      'réellement un accès : l’allumer coupe les ressources au-delà des quotas gratuits.',
  })
  basculerVerrou(
    @CurrentCountry() pays: string,
    @Body() dto: UpdateVerrouDto,
    @Request() req,
  ) {
    return this.verrou.basculer(pays, dto.verrou_actif, req.user?.utilisateurId);
  }

  // ── Commission de parrainage ─────────────────────────────────────────────

  @Get('commission')
  @ApiOperation({
    summary: 'Taux de commission de parrainage',
    description:
      'Part du prix payé versée au bénéficiaire — parrain d’inscription, ou propriétaire du ' +
      'code saisi à l’achat.',
  })
  commission() {
    return this.parrainage.reglageCommission();
  }

  @Put('commission')
  @ApiOperation({
    summary: 'Régler le taux de commission',
    description:
      'Prend effet immédiatement, sans déploiement. Ne modifie pas les commissions déjà versées.',
  })
  modifierCommission(@Body() dto: UpdateCommissionDto, @Request() req) {
    return this.parrainage.modifierCommission(dto, req.user?.utilisateurId);
  }

  // ── Quotas gratuits ──────────────────────────────────────────────────────

  @Get('quotas')
  @ApiOperation({
    summary: 'Plafonds des quotas gratuits',
    description: 'Nombre de ressources consultables et de lancements Ketsia sans abonnement.',
  })
  quotas_(@CurrentCountry() pays: string) {
    return this.quotas.reglages(pays);
  }

  @Put('quotas/:uuid')
  @ApiOperation({
    summary: 'Régler un plafond',
    description:
      'Prend effet immédiatement, sans déploiement. Baisser le plafond ne retire rien ' +
      'aux consommations déjà enregistrées sur la période en cours.',
  })
  modifierQuota(@Param('uuid') uuid: string, @Body() dto: UpdateQuotaDto) {
    return this.quotas.modifierReglage(uuid, {
      ...(dto.limite !== undefined ? { limite: dto.limite } : {}),
      ...(dto.periode_reset !== undefined ? { periode_reset: dto.periode_reset } : {}),
      ...(dto.est_actif !== undefined ? { est_actif: dto.est_actif } : {}),
    });
  }

  // ── Plans ────────────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'Tous les plans du pays, ouverts comme fermés' })
  plans(@CurrentCountry() pays: string) {
    return this.plansService.findAll(pays);
  }

  @Post('plans')
  @ApiOperation({ summary: 'Créer un plan' })
  creerPlan(@CurrentCountry() pays: string, @Body() dto: CreatePlanDto) {
    return this.plansService.create(pays, dto);
  }

  @Put('plans/:uuid')
  @ApiOperation({ summary: 'Modifier un plan (y compris son ouverture)' })
  modifierPlan(@Param('uuid') uuid: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(uuid, dto);
  }

  @Delete('plans/:uuid')
  @ApiOperation({
    summary: 'Fermer un plan',
    description:
      'Suppression logique : un plan référencé par un abonnement ne peut pas disparaître ' +
      'sans emporter l’historique.',
  })
  fermerPlan(@Param('uuid') uuid: string) {
    return this.plansService.desactiver(uuid);
  }

  // ── Abonnements ──────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Lister les abonnements (filtres statut, plan, recherche)' })
  liste(@CurrentCountry() pays: string, @Query() filtre: FilterAbonnementDto) {
    return this.abonnementsService.findAll(pays, filtre);
  }

  @Get(':uuid/evenements')
  @ApiOperation({ summary: 'Journal d’un abonnement' })
  evenements(@Param('uuid') uuid: string) {
    return this.abonnementsService.historique(uuid);
  }

  @Post(':uuid/activer')
  @ApiOperation({
    summary: 'Activer un abonnement encaissé hors application',
    description:
      'Chemin de secours tant que #248 n’est pas livrée, et utile ensuite : webhook perdu, ' +
      'paiement en espèces, geste commercial.',
  })
  activer(@Param('uuid') uuid: string, @Body() dto: ActiverAbonnementDto, @Request() req) {
    return this.abonnementsService.activer(uuid, dto, req.user?.utilisateurId);
  }

  @Get('classement-commissions')
  @ApiOperation({
    summary: 'Meilleurs bénéficiaires de commissions sur une période',
    description:
      'Classé par montant perçu. La date retenue est celle du VERSEMENT, pas celle de ' +
      'l’abonnement : une commission rattrapée appartient au mois où elle a été versée, ' +
      'sinon les totaux d’une période close changeraient après coup.',
  })
  classementCommissions(@Query() query: ClassementCommissionsDto) {
    return this.parrainage.classementCommissions(query);
  }

  @Get('commissions-en-attente')
  @ApiOperation({
    summary: 'Abonnements actifs dont la commission de parrainage n’est pas passée',
    description:
      'Wallet du parrain bloqué à l’activation, commission activée après coup, panne ' +
      'ponctuelle : autant de cas rattrapables.',
  })
  commissionsEnAttente(@CurrentCountry() pays: string) {
    return this.abonnementsService.commissionsEnAttente(pays);
  }

  @Post(':uuid/rattraper-commission')
  @ApiOperation({ summary: 'Rejouer le versement de la commission de parrainage' })
  rattraperCommission(@Param('uuid') uuid: string) {
    return this.abonnementsService.rattraperCommission(uuid);
  }

  @Post(':uuid/prolonger')
  @ApiOperation({ summary: 'Prolonger un abonnement actif' })
  prolonger(@Param('uuid') uuid: string, @Body() dto: ProlongerAbonnementDto) {
    return this.abonnementsService.prolonger(uuid, dto);
  }

  @Post(':uuid/annuler')
  @ApiOperation({ summary: 'Annuler un abonnement' })
  annuler(@Param('uuid') uuid: string, @Body() body: { motif?: string }) {
    return this.abonnementsService.annuler(uuid, body?.motif);
  }
}
