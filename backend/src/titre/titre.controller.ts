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
import { TitreService } from './titre.service';
import { CreateTitreDto } from './dto/create-titre.dto';
import { UpdateTitreDto } from './dto/update-titre.dto';
import { TitreQueryDto } from './dto/titre-query.dto';
import { Titre } from './entities/titre.entity';

@ApiTags('titre')
@Controller('titre')
export class TitreController {
  constructor(private readonly titreService: TitreService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer un nouveau titre' })
  @ApiResponse({ status: 201, description: 'Titre créé avec succès', type: Titre })
  async create(@Body() createTitreDto: CreateTitreDto): Promise<Titre> {
    return await this.titreService.create(createTitreDto);
  }

  @Get()
  @ApiOperation({ summary: 'Récupérer tous les titres' })
  @ApiResponse({ status: 200, description: 'Titres récupérés avec succès' })
  async findAll(@Query() query: TitreQueryDto) {
    return await this.titreService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un titre par son ID' })
  @ApiResponse({ status: 200, description: 'Titre récupéré avec succès', type: Titre })
  @ApiResponse({ status: 404, description: 'Titre non trouvé' })
  async findOne(@Param('id') id: string): Promise<Titre> {
    return await this.titreService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour un titre' })
  @ApiResponse({ status: 200, description: 'Titre mis à jour avec succès', type: Titre })
  @ApiResponse({ status: 404, description: 'Titre non trouvé' })
  async update(
    @Param('id') id: string,
    @Body() updateTitreDto: UpdateTitreDto,
  ): Promise<Titre> {
    return await this.titreService.update(+id, updateTitreDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer un titre' })
  @ApiResponse({ status: 204, description: 'Titre supprimé avec succès' })
  @ApiResponse({ status: 404, description: 'Titre non trouvé' })
  async remove(@Param('id') id: string): Promise<void> {
    return await this.titreService.remove(+id);
  }
}
