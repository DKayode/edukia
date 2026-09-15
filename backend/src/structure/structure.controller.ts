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
import { StructureService } from './structure.service';
import { CreateStructureDto } from './dto/create-structure.dto';
import { UpdateStructureDto } from './dto/update-structure.dto';
import { StructureQueryDto } from './dto/structure-query.dto';
import { Structure } from './entities/structure.entity';

@ApiTags('structure')
@Controller('structure')
export class StructureController {
  constructor(private readonly structureService: StructureService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer une nouvelle structure' })
  @ApiResponse({ status: 201, description: 'Structure créée avec succès', type: Structure })
  async create(@Body() createStructureDto: CreateStructureDto): Promise<Structure> {
    return await this.structureService.create(createStructureDto);
  }

  @Get()
  @ApiOperation({ summary: 'Récupérer toutes les structures' })
  @ApiResponse({ status: 200, description: 'Structures récupérées avec succès' })
  async findAll(@Query() query: StructureQueryDto) {
    return await this.structureService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer une structure par son ID' })
  @ApiResponse({ status: 200, description: 'Structure récupérée avec succès', type: Structure })
  @ApiResponse({ status: 404, description: 'Structure non trouvée' })
  async findOne(@Param('id') id: string): Promise<Structure> {
    return await this.structureService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour une structure' })
  @ApiResponse({ status: 200, description: 'Structure mise à jour avec succès', type: Structure })
  @ApiResponse({ status: 404, description: 'Structure non trouvée' })
  async update(
    @Param('id') id: string,
    @Body() updateStructureDto: UpdateStructureDto,
  ): Promise<Structure> {
    return await this.structureService.update(+id, updateStructureDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer une structure' })
  @ApiResponse({ status: 204, description: 'Structure supprimée avec succès' })
  @ApiResponse({ status: 404, description: 'Structure non trouvée' })
  async remove(@Param('id') id: string): Promise<void> {
    return await this.structureService.remove(+id);
  }
}
