import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Res,
  UseInterceptors,
  UploadedFile,
  Req,
  HttpCode
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';
import { CategoryQueryDto } from './dto/category-query.dto';
import { FichiersService } from 'src/fichiers/fichiers.service';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RoleType } from 'src/utilisateurs/entities/utilisateur.entity';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService, private readonly fichiersService: FichiersService) { }

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer une nouvelle catégorie' })
  @ApiResponse({ status: 201, description: 'Catégorie créée avec succès', type: Category })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 409, description: 'Catégorie déjà existante' })
  async create(@Body() createCategoryDto: CreateCategoryDto): Promise<Category> {
    return await this.categoriesService.create(createCategoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Récupérer toutes les catégories' })
  @ApiResponse({ status: 200, description: 'Catégories récupérées avec succès' })
  async findAll(@Query() query: CategoryQueryDto) {
    return await this.categoriesService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Récupérer les statistiques des catégories' })
  @ApiResponse({ status: 200, description: 'Statistiques récupérées avec succès' })
  async getStats() {
    return await this.categoriesService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer une catégorie par son ID' })
  @ApiResponse({ status: 200, description: 'Catégorie récupérée avec succès', type: Category })
  @ApiResponse({ status: 404, description: 'Catégorie non trouvée' })
  async findOne(@Param('id') id: string): Promise<Category> {
    return await this.categoriesService.findOne(+id);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Récupérer une catégorie par son slug' })
  @ApiResponse({ status: 200, description: 'Catégorie récupérée avec succès', type: Category })
  @ApiResponse({ status: 404, description: 'Catégorie non trouvée' })
  async findOneBySlug(@Param('slug') slug: string): Promise<Category> {
    return await this.categoriesService.findOneBySlug(slug);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour une catégorie' })
  @ApiResponse({ status: 200, description: 'Catégorie mise à jour avec succès', type: Category })
  @ApiResponse({ status: 404, description: 'Catégorie non trouvée' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  async update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<Category> {
    return await this.categoriesService.update(+id, updateCategoryDto);
  }

  @Patch(':id/icone')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Mettre à jour l\'icône d\'une catégorie' })
  @ApiResponse({ status: 200, description: 'Icône mise à jour avec succès', type: Category })
  async uploadIcon(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ): Promise<Category> {
    return await this.categoriesService.uploadIcon(+id, file, req.user.utilisateurId);
  }

  @Get(':id/icone')
  @ApiOperation({ summary: 'Récupérer l\'icône d\'une catégorie' })
  @ApiResponse({ status: 200, description: 'Icône récupérée avec succès' })
  @ApiResponse({ status: 404, description: 'Icône non trouvée' })
  async getIcon(
    @Param('id') id: string,
    @Res() res: any // using any or Response from express
  ) {
    const { buffer, contentType, filename } = await this.categoriesService.downloadIcon(+id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer une catégorie' })
  @ApiResponse({ status: 204, description: 'Catégorie supprimée avec succès' })
  @ApiResponse({ status: 404, description: 'Catégorie non trouvée' })
  @ApiResponse({ status: 400, description: 'Impossible de supprimer (contient des parcours)' })
  async remove(@Param('id') id: string): Promise<void> {
    return await this.categoriesService.remove(+id);
  }
}
