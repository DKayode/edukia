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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { DepartementService } from './departement.service';
import { CreerDepartementDto } from './dto/creer-departement.dto';
import { MajDepartementDto } from './dto/maj-departement.dto';
import { FilterDepartementDto } from './dto/filter-departement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';

@ApiTags('departements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('departements')
export class DepartementController {
  constructor(private readonly departementService: DepartementService) {}

  // Expose the identifier as `uuid` (the PK is a uuid) in the API response.
  private toResponse(d: any) {
    return d
      ? { uuid: d.id, nom: d.nom, code: d.code, pays: d.pays, date_creation: d.date_creation }
      : d;
  }

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Créer un département' })
  async create(
    @CurrentCountry() pays: string,
    @Body() dto: CreerDepartementDto,
  ) {
    return this.toResponse(await this.departementService.create(pays, dto));
  }

  @Post('import-csv')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Importer des départements via CSV (colonnes: nom,code). Scope via ?country=' })
  async importCsv(
    @CurrentCountry() pays: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.departementService.importCsv(pays, file);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les départements' })
  @ApiResponse({ status: 200, description: 'Liste récupérée avec succès' })
  async findAll(
    @CurrentCountry() pays: string,
    @Query() filterDto: FilterDepartementDto,
  ) {
    const res = await this.departementService.findAll(pays, filterDto);
    return { ...res, data: res.data.map((d) => this.toResponse(d)) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un département par son ID' })
  async findOne(@CurrentCountry() pays: string, @Param('id') id: string) {
    return this.toResponse(await this.departementService.findOne(pays, id));
  }

  @Get(':id/villes')
  @ApiOperation({ summary: "Lister les villes d'un département (par uuid)" })
  @ApiResponse({ status: 200, description: 'Villes du département' })
  async findVilles(@CurrentCountry() pays: string, @Param('id') id: string) {
    const villes = await this.departementService.findVilles(pays, id);
    return villes.map((v) => ({ uuid: v.id, nom: v.nom }));
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Mettre à jour un département' })
  async update(
    @CurrentCountry() pays: string,
    @Param('id') id: string,
    @Body() dto: MajDepartementDto,
  ) {
    return this.toResponse(await this.departementService.update(pays, id, dto));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Supprimer un département' })
  async remove(@CurrentCountry() pays: string, @Param('id') id: string) {
    return this.departementService.remove(pays, id);
  }
}
