import { Controller, Get, Post, Body, Patch, Param, Delete, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { ParcoursService } from './parcours.service';
import { CreateParcourDto } from './dto/create-parcour.dto';
import { UpdateParcourDto } from './dto/update-parcour.dto';
import { ParcourQueryDto } from './dto/parcour-query.dto';
import { Parcour } from './entities/parcour.entity';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FichiersService } from 'src/fichiers/fichiers.service';
import { JournaliserConsultation } from '../resource-access/journaliser-consultation.decorator';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RoleType } from 'src/utilisateurs/entities/utilisateur.entity';

@ApiTags('parcours')
@Controller('parcours')
export class ParcoursController {
  constructor(
    private readonly parcoursService: ParcoursService,
    private readonly fichiersService: FichiersService,
  ) { }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Post()
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Créer un nouveau parcours' })
  @ApiResponse({ status: 201, description: 'Parcours créé avec succès', type: Parcour })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  async create(@Body() createParcoursDto: CreateParcourDto): Promise<Parcour> {
    return await this.parcoursService.create(createParcoursDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Récupérer tous les parcours avec pagination et filtres' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Numéro de page' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Nombre d\'éléments par page' })
  @ApiQuery({ name: 'titre', required: false, type: String, description: 'Filtrer par titre' })
  @ApiQuery({ name: 'categorie', required: false, type: String, description: 'Filtrer par catégorie' })
  @ApiQuery({ name: 'type_media', required: false, enum: ['image', 'video'], description: 'Filtrer par type de média' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Recherche globale' })
  @ApiResponse({ status: 200, description: 'Liste des parcours récupérée avec succès' })
  async findAll(@Query() query: ParcourQueryDto) {
    return await this.parcoursService.findAll(query);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @JournaliserConsultation('parcours')
  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un parcours par son ID' })
  @ApiParam({ name: 'id', description: 'ID du parcours' })
  @ApiResponse({ status: 200, description: 'Parcours récupéré avec succès', type: Parcour })
  @ApiResponse({ status: 404, description: 'Parcours non trouvé' })
  async findOne(@Param('id') id: number): Promise<Parcour> {
    return await this.parcoursService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Mettre à jour un parcours' })
  @ApiParam({ name: 'id', description: 'ID du parcours à mettre à jour' })
  @ApiResponse({ status: 200, description: 'Parcours mis à jour avec succès', type: Parcour })
  @ApiResponse({ status: 404, description: 'Parcours non trouvé' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  async update(
    @Param('id') id: number,
    @Body() updateParcoursDto: UpdateParcourDto,
  ): Promise<Parcour> {
    return await this.parcoursService.update(id, updateParcoursDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un parcours' })
  @ApiParam({ name: 'id', description: 'ID du parcours à supprimer' })
  @ApiResponse({ status: 204, description: 'Parcours supprimé avec succès' })
  @ApiResponse({ status: 404, description: 'Parcours non trouvé' })
  async remove(@Param('id') id: number): Promise<void> {
    await this.parcoursService.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('search/:term')
  @ApiOperation({ summary: 'Rechercher des parcours' })
  @ApiParam({ name: 'term', description: 'Terme de recherche' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Limite des résultats' })
  @ApiResponse({ status: 200, description: 'Résultats de la recherche' })
  async search(
    @Param('term') term: string,
    @Query('limit') limit?: number,
  ) {
    return await this.parcoursService.search(term, limit);
  }
  @Get(':id/image')
  @ApiOperation({ summary: 'Télécharger l\'image de couverture' })
  @ApiParam({ name: 'id', description: 'ID du parcours' })
  @ApiResponse({ status: 200, description: 'Fichier téléchargé avec succès' })
  @ApiResponse({ status: 404, description: 'Image non trouvée' })
  async downloadImage(
    @Param('id') id: number,
    @Res() res: Response
  ) {
    const { url } = await this.parcoursService.findOneForDownloadImage(id);
    const { buffer, contentType, filename } = await this.fichiersService.downloadFile(url);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(HttpStatus.OK).send(buffer);
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'Télécharger le contenu média (Image uniquement)' })
  @ApiParam({ name: 'id', description: 'ID du parcours' })
  @ApiResponse({ status: 200, description: 'Fichier téléchargé avec succès' })
  @ApiResponse({ status: 400, description: 'Type de média incompatible' })
  @ApiResponse({ status: 404, description: 'Média non trouvé' })
  async downloadMedia(
    @Param('id') id: number,
    @Res() res: Response
  ) {
    const { url } = await this.parcoursService.findOneForDownloadMedia(id);
    const { buffer, contentType, filename } = await this.fichiersService.downloadFile(url);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(HttpStatus.OK).send(buffer);
  }

  @Get(':id/lien')
  @ApiOperation({ summary: 'Récupérer le lien vidéo' })
  @ApiParam({ name: 'id', description: 'ID du parcours' })
  @ApiResponse({ status: 200, description: 'Lien récupéré avec succès' })
  @ApiResponse({ status: 400, description: 'Type de média incompatible' })
  @ApiResponse({ status: 404, description: 'Lien non trouvé' })
  async getLink(@Param('id') id: number) {
    return await this.parcoursService.findOneForLink(id);
  }

  @Get(':id/categorie/icon')
  @ApiOperation({ summary: 'Récupérer l\'icône de la catégorie associée au parcours' })
  @ApiParam({ name: 'id', description: 'ID du parcours' })
  @ApiResponse({ status: 200, description: 'Icône récupérée avec succès' })
  @ApiResponse({ status: 404, description: 'Parcours, catégorie ou icône non trouvée' })
  async getCategoryIcon(
    @Param('id') id: number,
    @Res() res: Response
  ) {
    const { url } = await this.parcoursService.findOneForCategoryIcon(id);
    const { buffer, contentType, filename } = await this.fichiersService.downloadFile(url);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.status(HttpStatus.OK).send(buffer);
  }
}
