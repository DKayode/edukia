import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';
import { CodesService } from './codes.service';
import { CreateCodeDto } from './dto/create-code.dto';
import { FilterCodesDto } from './dto/filter-codes.dto';
import { GenererCampagneDto } from './dto/generer-campagne.dto';
import { UpdateCodeDto } from './dto/update-code.dto';
import { CommandesCodesService } from './commandes-codes.service';

@ApiTags('codes-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleType.ADMIN)
@Controller('admin/codes')
export class CodesAdminController {
  constructor(
    private readonly codesService: CodesService,
    private readonly commandes_: CommandesCodesService,
  ) {}


  // ── Commandes groupées ───────────────────────────────────────────────────

  @Get('commandes')
  @ApiOperation({
    summary: 'Lister les achats groupés',
    description:
      'Répond à la question du support : « il dit avoir payé, où en est-il ? ». ' +
      '`livraison_incomplete` signale une commande payée dont les codes manquent.',
  })
  @ApiQuery({ name: 'statut', required: false })
  @ApiQuery({ name: 'recherche', required: false, description: 'Nom, courriel ou identifiant de commande' })
  commandes(
    @CurrentCountry() pays: string,
    @Query('statut') statut?: string,
    @Query('recherche') recherche?: string,
  ) {
    return this.commandes_.listeAdmin(pays, { statut: statut as any, recherche });
  }

  @Get('commandes/:uuid/codes')
  @ApiOperation({ summary: 'Les codes d’une commande, et qui les a utilisés' })
  codesDeLaCommande(@Param('uuid') uuid: string) {
    return this.commandes_.codesDeLaCommande(uuid);
  }

  @Post('commandes/:uuid/completer')
  @ApiOperation({
    summary: 'Relivrer les codes manquants d’une commande payée',
    description:
      'Pour le cas où des collisions répétées ont fait livrer moins que payé. ' +
      'N’engendre QUE les manquants — régénérer tout doublerait les codes déjà envoyés.',
  })
  completer(@Param('uuid') uuid: string) {
    return this.commandes_.completerLivraison(uuid).then((n) => ({ codes_ajoutes: n }));
  }

  @Get()
  @ApiOperation({
    summary: 'Lister les codes',
    description:
      'Sans filtre de type, les codes de PARRAINAGE sont exclus : générés à l’inscription, ' +
      'ils noieraient le catalogue promo sous des dizaines de milliers de lignes.',
  })
  liste(@CurrentCountry() pays: string, @Query() filtre: FilterCodesDto) {
    return this.codesService.findAll(pays, filtre);
  }

  @Post()
  @ApiOperation({ summary: 'Créer un code — cas « un code, n utilisations »' })
  creer(@CurrentCountry() pays: string, @Body() dto: CreateCodeDto, @Request() req) {
    return this.codesService.create(pays, dto, req.user?.utilisateurId);
  }

  @Put(':uuid')
  @ApiOperation({ summary: 'Modifier un code' })
  modifier(@Param('uuid') uuid: string, @Body() dto: UpdateCodeDto) {
    return this.codesService.update(uuid, dto);
  }

  @Delete(':uuid')
  @ApiOperation({
    summary: 'Désactiver un code',
    description: 'Suppression logique : un code déjà utilisé garde son historique.',
  })
  desactiver(@Param('uuid') uuid: string) {
    return this.codesService.desactiver(uuid);
  }

  @Get(':uuid/utilisations')
  @ApiOperation({ summary: 'Qui a utilisé ce code, et pour quelle remise' })
  utilisations(@Param('uuid') uuid: string) {
    return this.codesService.utilisationsDuCode(uuid);
  }

  // ── Campagnes ────────────────────────────────────────────────────────────

  @Get('campagnes/liste')
  @ApiOperation({ summary: 'Campagnes du pays, avec le nombre de codes générés et utilisés' })
  campagnes(@CurrentCountry() pays: string) {
    return this.codesService.campagnesList(pays);
  }

  @Post('campagnes')
  @ApiOperation({
    summary: 'Générer n codes uniques à usage unique',
    description: 'Le second cas de l’issue : n codes, une utilisation chacun, pour n personnes.',
  })
  genererCampagne(@CurrentCountry() pays: string, @Body() dto: GenererCampagneDto, @Request() req) {
    return this.codesService.genererCampagne(pays, dto, req.user?.utilisateurId);
  }

  @Get('campagnes/:uuid/export')
  @ApiOperation({ summary: 'Export CSV des codes d’une campagne, pour distribution' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="codes.csv"')
  exporter(@Param('uuid') uuid: string) {
    return this.codesService.exporterCampagne(uuid);
  }
}
