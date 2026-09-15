import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { VilleService } from './ville.service';
import { CreerVilleDto } from './dto/creer-ville.dto';
import { MajVilleDto } from './dto/maj-ville.dto';
import { FilterVilleDto } from './dto/filter-ville.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';

@ApiTags('villes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('villes')
export class VilleController {
  constructor(private readonly villeService: VilleService) {}

  // Expose `uuid` (the PK is a uuid) and only the nested `departement` object
  // ({ uuid, nom }); the raw `departement_id` is dropped (redundant).
  private toResponse(v: any) {
    return v
      ? {
          uuid: v.id,
          nom: v.nom,
          pays: v.pays,
          date_creation: v.date_creation,
          departement: v.departement
            ? { uuid: v.departement.id, nom: v.departement.nom }
            : null,
        }
      : v;
  }

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Créer une ville (scopée au département parent)' })
  async create(@CurrentCountry() pays: string, @Body() dto: CreerVilleDto) {
    return this.toResponse(await this.villeService.create(pays, dto));
  }

  @Post('import-csv')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Importer des villes via CSV (colonnes: departement_nom,ville_nom). Scope via ?country=' })
  async importCsv(
    @CurrentCountry() pays: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.villeService.importCsv(pays, file);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les villes (filtre optionnel ?departement_id=)' })
  @ApiResponse({ status: 200, description: 'Liste récupérée avec succès' })
  @ApiQuery({ name: 'departement_id', required: false, type: Number, description: 'Filtrer par département' })
  async findAll(
    @CurrentCountry() pays: string,
    @Query() filterDto: FilterVilleDto,
  ) {
    const res = await this.villeService.findAll(pays, filterDto);
    return { ...res, data: res.data.map((v) => this.toResponse(v)) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer une ville par son ID' })
  async findOne(@CurrentCountry() pays: string, @Param('id') id: string) {
    return this.toResponse(await this.villeService.findOne(pays, id));
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Mettre à jour une ville' })
  async update(
    @CurrentCountry() pays: string,
    @Param('id') id: string,
    @Body() dto: MajVilleDto,
  ) {
    return this.toResponse(await this.villeService.update(pays, id, dto));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer une ville' })
  async remove(@CurrentCountry() pays: string, @Param('id') id: string) {
    return this.villeService.remove(pays, id);
  }
}
