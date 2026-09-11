import { Controller, Get, Post, Body, Put, Param, Delete, UseGuards, Request, Query, Res, HttpStatus, ParseIntPipe, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { EpreuvesService } from './epreuves.service';
import { CreerEpreuveDto } from './dto/creer-epreuve.dto';
import { MajEpreuveDto } from './dto/maj-epreuve.dto';
import { EpreuveResponseDto } from './dto/epreuve-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { FilterEpreuveDto } from './dto/filter-epreuve.dto';
import { FichiersService } from '../fichiers/fichiers.service';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { ResourceAccessService } from '../resource-access/resource-access.service';
import { EntitlementService, Feature } from '../abonnements/entitlement.service';
import { QuotaService } from '../abonnements/quota.service';
import { ProfilIncompletException, QuotaDepasseException } from '../abonnements/quota.guard';
import { FeatureQuota } from '../abonnements/entities/quota-consommation.entity';

@ApiTags('epreuves')
@Controller('epreuves')
export class EpreuvesController {
  private readonly logger = new Logger(EpreuvesController.name);

  constructor(
    private readonly epreuvesService: EpreuvesService,
    private readonly fichiersService: FichiersService,
    private readonly resourceAccessService: ResourceAccessService,
    private readonly entitlement: EntitlementService,
    private readonly quotas: QuotaService,
  ) { }

  /**
   * Décide de servir une épreuve, en consommant le quota gratuit si besoin.
   *
   * L'ordre compte : on consomme AVANT de servir. Si le téléchargement échoue
   * après coup, l'unité est perdue — acceptable, parce que la ressource reste
   * consommée à vie et qu'un nouvel essai sur la MÊME épreuve ne recompte pas.
   * L'inverse (servir puis consommer) laisserait un client abandonner la
   * requête au bon moment pour ne jamais rien décompter.
   */
  private async autoriserOuConsommer(req: any, epreuveId: number, pays: string): Promise<void> {
    const utilisateurId = req.user?.utilisateurId;
    const decision = await this.entitlement.check(utilisateurId, Feature.EPREUVE_VIEW, req.user?.role, pays);

    // Profil incomplet : refuser SANS consommer. Décompter une unité à
    // quelqu'un qui n'a rien pu lire lui ferait perdre son quota pour rien.
    if (decision.reason === 'PROFIL_INCOMPLET') {
      if (!this.entitlement.verrouActif(pays)) {
        this.logger.warn(
          `[verrou éteint] profil incomplet — utilisateur=${utilisateurId} epreuve=${epreuveId} ` +
            `(${decision.quota?.used}/${decision.quota?.limit} %)`,
        );
        return;
      }
      throw new ProfilIncompletException(Feature.EPREUVE_VIEW, decision);
    }

    // Rien à décompter : abonné, admin, ou quota désactivé par l'administration.
    // L'absence de `quota` sur une décision autorisée est justement le signal
    // qu'aucun plafond ne s'applique — inutile d'aller le chercher.
    if (decision.allowed && !decision.quota) return;

    const resultat = await this.quotas.consommer(
      utilisateurId, FeatureQuota.RESOURCE_VIEW, 'epreuve', epreuveId, pays,
    );
    if (resultat.allowed) return;

    if (!this.entitlement.verrouActif(pays)) {
      this.logger.warn(
        `[verrou éteint] quota épuisé — feature=EPREUVE_VIEW utilisateur=${utilisateurId} ` +
          `epreuve=${epreuveId} (${resultat.used}/${resultat.limit})`,
      );
      return;
    }
    throw new QuotaDepasseException(Feature.EPREUVE_VIEW, resultat);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Request() req, @Body() creerEpreuveDto: CreerEpreuveDto) {
    return this.epreuvesService.create(creerEpreuveDto, req.user.utilisateurId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'Récupérer la liste des épreuves' })
  @ApiResponse({ status: 200, description: 'Liste récupérée avec succès' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Numéro de page' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Nombre d\'éléments par page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Recherche globale (titre ou matière)' })
  @ApiQuery({ name: 'type', required: false, type: String, description: 'Filtrer par type (Interrogation, Devoirs, Concours, Examens)' })
  @ApiQuery({ name: 'matiere', required: false, type: String, description: 'Filtrer par nom de matière' })
  @ApiQuery({ name: 'sort_by', required: false, type: String, description: 'Champ de tri (ex: date_creation)' })
  @ApiQuery({ name: 'sort_order', required: false, enum: ['ASC', 'DESC'], description: 'Ordre de tri' })
  async findAll(@CurrentCountry() pays: string, @Query() filterDto: FilterEpreuveDto, @Request() req) {
    return this.epreuvesService.findAll(pays, filterDto, req.user?.utilisateurId, req.user?.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/telechargement')
  async downloadFile(
    @Param('id') id: string,
    @CurrentCountry() pays: string,
    @Request() req,
    @Res() res: Response
  ) {
    await this.autoriserOuConsommer(req, +id, pays);

    const { url } = await this.epreuvesService.findOneForDownload(String(id));
    const { buffer, contentType, filename } = await this.fichiersService.downloadFile(url);

    await this.resourceAccessService.log('epreuve', +id, req.user?.utilisateurId ?? null, pays);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(HttpStatus.OK).send(buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentCountry() pays: string, @Request() req): Promise<any> {
    return this.epreuvesService.findOne(String(id), req.user?.utilisateurId, req.user?.role, pays);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() majEpreuveDto: MajEpreuveDto) {
    return this.epreuvesService.update(String(id), majEpreuveDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.epreuvesService.remove(String(id));
  }
}
