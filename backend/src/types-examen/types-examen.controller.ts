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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RoleType } from 'src/utilisateurs/entities/utilisateur.entity';
import { CurrentCountry } from 'src/common/decorators/current-country.decorator';
import { TypesExamenService } from './types-examen.service';
import { CreateTypeExamenDto } from './dto/create-type-examen.dto';
import { UpdateTypeExamenDto } from './dto/update-type-examen.dto';
import { TypeExamenQueryDto } from './dto/type-examen-query.dto';
import { TypeExamen } from './entities/type-examen.entity';

@ApiTags('types-examen')
@Controller('types-examen')
export class TypesExamenController {
  constructor(private readonly typesExamenService: TypesExamenService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Créer un nouveau type d'examen" })
  @ApiResponse({ status: 201, description: "Type d'examen créé avec succès", type: TypeExamen })
  async create(
    @CurrentCountry() pays: string,
    @Body() createTypeExamenDto: CreateTypeExamenDto,
  ): Promise<TypeExamen> {
    return await this.typesExamenService.create(pays, createTypeExamenDto);
  }

  @Get()
  @ApiOperation({ summary: "Récupérer tous les types d'examen" })
  @ApiResponse({ status: 200, description: "Types d'examen récupérés avec succès" })
  async findAll(@CurrentCountry() pays: string, @Query() query: TypeExamenQueryDto) {
    return await this.typesExamenService.findAll(pays, query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Récupérer un type d'examen par son ID" })
  @ApiResponse({ status: 200, description: "Type d'examen récupéré avec succès", type: TypeExamen })
  @ApiResponse({ status: 404, description: "Type d'examen non trouvé" })
  async findOne(@Param('id') id: string): Promise<TypeExamen> {
    return await this.typesExamenService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Mettre à jour un type d'examen" })
  @ApiResponse({ status: 200, description: "Type d'examen mis à jour avec succès", type: TypeExamen })
  @ApiResponse({ status: 404, description: "Type d'examen non trouvé" })
  async update(
    @Param('id') id: string,
    @Body() updateTypeExamenDto: UpdateTypeExamenDto,
  ): Promise<TypeExamen> {
    return await this.typesExamenService.update(+id, updateTypeExamenDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: "Supprimer un type d'examen" })
  @ApiResponse({ status: 204, description: "Type d'examen supprimé avec succès" })
  @ApiResponse({ status: 404, description: "Type d'examen non trouvé" })
  async remove(@Param('id') id: string): Promise<void> {
    return await this.typesExamenService.remove(+id);
  }
}
