import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RoleType } from 'src/utilisateurs/entities/utilisateur.entity';
import { SeriesService } from './series.service';
import { CreateSerieDto } from './dto/create-serie.dto';
import { UpdateSerieDto } from './dto/update-serie.dto';
import { SerieQueryDto } from './dto/serie-query.dto';
import { Serie } from './entities/serie.entity';
import { CurrentCountry } from '../common/decorators/current-country.decorator';

@ApiTags('series')
@Controller('series')
export class SeriesController {
  constructor(private readonly seriesService: SeriesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer une nouvelle série (scopée au type d\'examen parent)' })
  @ApiResponse({ status: 201, description: 'Série créée avec succès', type: Serie })
  async create(
    @CurrentCountry() pays: string,
    @Body() createSerieDto: CreateSerieDto,
  ): Promise<Serie> {
    return await this.seriesService.create(pays, createSerieDto);
  }

  @Get()
  @ApiOperation({ summary: 'Récupérer toutes les séries' })
  @ApiResponse({ status: 200, description: 'Séries récupérées avec succès' })
  @ApiQuery({ name: 'type_examen', required: false, type: Number, description: "Filtrer par ID du type d'examen parent" })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Rechercher par nom' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(@CurrentCountry() pays: string, @Query() query: SerieQueryDto) {
    return await this.seriesService.findAll(pays, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer une série par son ID' })
  @ApiResponse({ status: 200, description: 'Série récupérée avec succès', type: Serie })
  @ApiResponse({ status: 404, description: 'Série non trouvée' })
  async findOne(@CurrentCountry() pays: string, @Param('id') id: string): Promise<Serie> {
    return await this.seriesService.findOne(pays, +id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour une série' })
  @ApiResponse({ status: 200, description: 'Série mise à jour avec succès', type: Serie })
  @ApiResponse({ status: 404, description: 'Série non trouvée' })
  async update(
    @CurrentCountry() pays: string,
    @Param('id') id: string,
    @Body() updateSerieDto: UpdateSerieDto,
  ): Promise<Serie> {
    return await this.seriesService.update(pays, +id, updateSerieDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer une série' })
  @ApiResponse({ status: 204, description: 'Série supprimée avec succès' })
  @ApiResponse({ status: 404, description: 'Série non trouvée' })
  async remove(@CurrentCountry() pays: string, @Param('id') id: string): Promise<void> {
    return await this.seriesService.remove(pays, +id);
  }
}
