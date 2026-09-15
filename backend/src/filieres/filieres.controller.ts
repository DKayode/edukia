import { Controller, Get, Post, Body, Put, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { FilieresService } from './filieres.service';
import { CreerFiliereDto } from './dto/creer-filiere.dto';
import { MajFiliereDto } from './dto/maj-filiere.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { FilterFiliereDto } from './dto/filter-filiere.dto';
import { FiliereResponseDto } from './dto/filiere-response.dto';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';

@ApiTags('filieres')
@Controller('filieres')
export class FilieresController {
  constructor(private readonly filieresService: FilieresService) { }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Post()
  async create(@Body() creerFiliereDto: CreerFiliereDto) {
    return this.filieresService.create(creerFiliereDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Récupérer la liste des filières' })
  @ApiResponse({ status: 200, description: 'Liste récupérée avec succès' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Numéro de page' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Nombre d\'éléments par page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Recherche globale (nom filière, nom établissement, ville établissement)' })
  @ApiQuery({ name: 'etablissement', required: false, type: String, description: 'Filtrer par nom d\'établissement' })
  async findAll(@CurrentCountry() pays: string, @Query() filterDto: FilterFiliereDto) {
    return this.filieresService.findAll(pays, filterDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get(':id')
  @ApiResponse({ type: FiliereResponseDto })
  async findOne(@Param('id') id: string) {
    return this.filieresService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() majFiliereDto: MajFiliereDto) {
    return this.filieresService.update(id, majFiliereDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.filieresService.remove(id);
  }
}
