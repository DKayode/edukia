import { Controller, Get, Post, Body, Put, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NiveauEtudeService } from './niveau-etude.service';
import { CreerNiveauEtudeDto } from './dto/creer-niveau-etude.dto';
import { MajNiveauEtudeDto } from './dto/maj-niveau-etude.dto';
import { NiveauEtudeResponseDto } from './dto/niveau-etude-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { FilterNiveauEtudeDto } from './dto/filter-niveau-etude.dto';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';

@ApiTags('niveau-etude')
@Controller('niveau-etude')
export class NiveauEtudeController {
  constructor(private readonly niveauEtudeService: NiveauEtudeService) { }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Post()
  async create(@CurrentCountry() pays: string, @Body() creerNiveauEtudeDto: CreerNiveauEtudeDto) {
    return this.niveauEtudeService.create(pays, creerNiveauEtudeDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Récupérer la liste des niveaux d\'étude' })
  @ApiResponse({ status: 200, description: 'Liste récupérée avec succès' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Numéro de page' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Nombre d\'éléments par page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Recherche globale (nom niveau, nom filière)' })
  @ApiQuery({ name: 'filiere', required: false, type: String, description: 'Filtrer par nom de filière (insensible à la casse et aux accents)' })
  @ApiQuery({ name: 'filiere_id', required: false, type: Number, description: 'Filtrer par identifiant de filière — préférable au nom' })
  @ApiQuery({ name: 'all', required: false, type: Boolean, description: "Accepté mais SANS EFFET : la liste renvoie déjà tous les niveaux, avec ou sans épreuve. Conservé pour ne pas rejeter les clients qui l'envoient." })
  async findAll(@CurrentCountry() pays: string, @Query() filterDto: FilterNiveauEtudeDto) {
    return this.niveauEtudeService.findAll(pays, filterDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get('grouper-par-nom')
  @ApiOperation({ summary: 'Récupérer les niveaux groupés par nom avec pagination' })
  async findGroupByName(@CurrentCountry() pays: string, @Query() paginationDto: PaginationDto) {
    return this.niveauEtudeService.findGroupByName(pays, paginationDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<NiveauEtudeResponseDto> {
    return this.niveauEtudeService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() majNiveauEtudeDto: MajNiveauEtudeDto) {
    return this.niveauEtudeService.update(id, majNiveauEtudeDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.niveauEtudeService.remove(id);
  }
  @UseGuards(JwtAuthGuard)
  @Delete('grouper-par-nom/:nom')
  @ApiOperation({ summary: 'Supprimer tous les niveaux portant un nom dans un pays donné' })
  @ApiQuery({ name: 'country', required: true, description: 'Country slug; this DELETE targets rows by name and needs the scope explicit.' })
  async removeGroup(@CurrentCountry() pays: string, @Param('nom') nom: string) {
    return this.niveauEtudeService.removeGroup(pays, nom);
  }



}
