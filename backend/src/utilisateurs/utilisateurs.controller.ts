import { FilterUtilisateurDto } from './dto/filter-utilisateur.dto';
import { Controller, Get, Post, Body, Put, Param, Delete, UseGuards, Request, Query, Patch, UseInterceptors, UploadedFile, Res, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { UtilisateursService } from './utilisateurs.service';
import { InscriptionDto } from './dto/inscription.dto';
import { MajUtilisateurDto } from './dto/maj-utilisateur.dto';
import { UpdateProfilDto } from './dto/update-profil.dto';
import { VerifyEmailDto, ValidateEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleType } from './entities/utilisateur.entity';
import { OwnerOrAdminGuard } from '../auth/guards/owner-or-admin.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentCountry } from '../common/decorators/current-country.decorator';
import { ProfilCompletionService } from './profil-completion.service';

@ApiTags('utilisateurs')
@Controller('utilisateurs')
export class UtilisateursController {
  constructor(
    private readonly utilisateursService: UtilisateursService,
    private readonly profilCompletion: ProfilCompletionService,
  ) { }

  @Post('inscription')
  async inscription(@CurrentCountry() pays: string, @Body() inscriptionDto: InscriptionDto) {
    return this.utilisateursService.inscription(pays, inscriptionDto);
  }



  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Récupérer la liste des utilisateurs' })
  @ApiResponse({ status: 200, description: 'Liste récupérée avec succès' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Numéro de page' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Nombre d\'éléments par page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Recherche globale (nom ou email)' })
  @ApiQuery({ name: 'role', required: false, enum: RoleType, description: 'Filtrer par rôle' })
  @ApiQuery({ name: 'sort_by', required: false, type: String, description: 'Champ de tri (ex: date_creation, filleuls)' })
  @ApiQuery({ name: 'sort_order', required: false, enum: ['ASC', 'DESC'], description: 'Ordre de tri' })
  async findAll(@CurrentCountry() pays: string, @Query() filterDto: FilterUtilisateurDto) {
    return this.utilisateursService.findAll(pays, filterDto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Get('appareils-partages')
  @ApiOperation({ summary: 'Comptes partageant un même token FCM (appareils partagés)' })
  async sharedDevices(@CurrentCountry() pays: string, @Query() filterDto: FilterUtilisateurDto) {
    return this.utilisateursService.findSharedDevices(pays, filterDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profil/completion')
  @ApiOperation({
    summary: 'Pourcentage de complétion du profil, et ce qu’il reste à remplir',
    description:
      'La liste `manquants` est l’essentiel : un pourcentage nu ne dit pas à l’utilisateur ' +
      'quoi faire. `conforme` vaut true tant que le seuil n’est pas activé.',
  })
  async completionProfil(@CurrentCountry() pays: string, @Request() req) {
    return this.profilCompletion.pourUtilisateur(req.user?.utilisateurId, pays);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profil')
  @ApiOperation({ summary: 'Récupérer le profil utilisateur (JSON)' })
  async getProfil(@Request() req) {
    const userId = req.user.utilisateurId.toString();
    const email = req.user.email;
    console.log(`[UtilisateursController] Récupération du profil pour l'utilisateur: ${email} (ID: ${userId})`);
    // Unified complete user shape (geo {uuid,nom} + age_group + booleans + type_profil) via the service.
    const profil = await this.utilisateursService.findOne(userId);
    return this.utilisateursService.enrichUserComplete(profil);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Créer un nouvel utilisateur (Admin)' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé avec succès' })
  async create(@CurrentCountry() pays: string, @Body() inscriptionDto: InscriptionDto) {
    return this.utilisateursService.inscription(pays, inscriptionDto, { trustedBackOffice: true });
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Post('backfill-referral-codes')
  @ApiOperation({ summary: 'Générer des codes de parrainage pour les utilisateurs existants qui n\'en ont pas (Admin)' })
  @ApiResponse({ status: 200, description: 'Backfill terminé' })
  async backfillReferralCodes() {
    return this.utilisateursService.generateMissingReferralCodes();
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleType.ADMIN)
  @Post('backfill-uuids')
  @ApiOperation({ summary: 'Générer des UUIDs pour les utilisateurs existants qui n\'en ont pas (Admin)' })
  @ApiResponse({ status: 200, description: 'Backfill terminé' })
  async backfillUuids() {
    return this.utilisateursService.generateMissingUuids();
  }

  @UseGuards(JwtAuthGuard)
  @Get('code-parrainage')
  @ApiOperation({ summary: 'Récupérer son propre code de parrainage' })
  @ApiResponse({ status: 200, description: 'Code récupéré avec succès' })
  async getMyReferralCode(@Request() req) {
    const userId = req.user.utilisateurId;
    return this.utilisateursService.getReferralCode(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put()
  @ApiOperation({ summary: 'Mettre à jour son propre profil' })
  @ApiResponse({ status: 200, description: 'Profil mis à jour avec succès' })
  async updateProfile(@Request() req, @Body() updateProfilDto: UpdateProfilDto) {
    const userId = req.user.utilisateurId;
    return this.utilisateursService.update(userId, updateProfilDto);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Demander la vérification d\'email (envoie un code)' })
  @ApiResponse({ status: 200, description: 'Code de vérification envoyé avec succès' })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.utilisateursService.verifyEmail(verifyEmailDto.email);
  }

  @Post('validate-email')
  @ApiOperation({ summary: 'Valider le code pour confirmer l\'adresse email' })
  @ApiResponse({ status: 200, description: 'Email validé avec succès' })
  async validateEmail(@Body() validateEmailDto: ValidateEmailDto) {
    return this.utilisateursService.validateEmail(validateEmailDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('is-email-verify')
  @ApiOperation({ summary: 'Vérifier si l\'email de l\'utilisateur connecté est vérifié' })
  async isEmailVerify(@Request() req) {
    const userId = req.user.utilisateurId;
    return this.utilisateursService.isEmailVerified(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('is-prestataire')
  @ApiOperation({ summary: 'Vérifier si l\'utilisateur connecté possède un profil prestataire' })
  async isPrestataire(@Request() req) {
    const userId = req.user.utilisateurId;
    return this.utilisateursService.isPrestataire(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('is-recruteur')
  @ApiOperation({ summary: 'Vérifier si l\'utilisateur connecté possède un profil recruteur' })
  async isRecruteur(@Request() req) {
    const userId = req.user.utilisateurId;
    return this.utilisateursService.isRecruteur(userId);
  }

  @UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateProfilDto: UpdateProfilDto) {
    return this.utilisateursService.update(id, updateProfilDto);
  }

  @UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un utilisateur (Soft Delete)' })
  async remove(@Param('id') id: string) {
    await this.utilisateursService.softDelete(parseInt(id));
    return { message: 'Utilisateur supprimé avec succès. Il sera définitivement effacé dans 30 jours.' };
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  @ApiOperation({ summary: 'Supprimer son propre compte (Soft Delete)' })
  @ApiResponse({ status: 200, description: 'Compte marqué pour suppression' })
  async removeSelf(@Request() req) {
    const userId = req.user.utilisateurId;
    await this.utilisateursService.softDelete(userId);
    return { message: 'Compte supprimé avec succès. Il sera définitivement effacé dans 30 jours.' };
  }

  @Patch('me/update/fcm-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour son propre token FCM' })
  async updateMyFcmToken(
    @Request() req: any,
    @Body() updateDto: any,
  ) {
    const userId = req.user.utilisateurId
    const updatedUser = await this.utilisateursService.updateFcmToken(
      userId,
      updateDto.token,
    );

    return {
      success: true,
      message: 'Votre token FCM a été mis à jour',
      hasToken: !!updatedUser.fcm_token,
    };

  }
  @UseGuards(JwtAuthGuard)
  @Patch('photo')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Mettre à jour ma photo de profil' })
  @ApiResponse({ status: 200, description: 'Photo mise à jour avec succès' })
  async uploadPhoto(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = req.user.utilisateurId.toString();
    return this.utilisateursService.uploadPhoto(userId, file);
  }

  @UseGuards(JwtAuthGuard)
  @Get('photo')
  @ApiOperation({ summary: 'Récupérer ma photo de profil' })
  @ApiResponse({ status: 200, description: 'Photo récupérée avec succès' })
  @ApiResponse({ status: 404, description: 'Photo non trouvée' })
  async getPhoto(
    @Request() req,
    @Res() res: any
  ) {
    const userId = req.user.utilisateurId.toString();
    const { buffer, contentType, filename } = await this.utilisateursService.downloadPhoto(userId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.status(HttpStatus.OK).send(buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':uuid')
  @ApiOperation({ summary: "Récupérer le profil d'un utilisateur par son UUID" })
  @ApiResponse({ status: 200, description: 'Profil récupéré avec succès' })
  @ApiResponse({ status: 404, description: 'Utilisateur non trouvé' })
  async getByUuid(@Param('uuid') uuid: string) {
    // geo-profile: same unified complete user shape as the list + /profil
    const profil = await this.utilisateursService.findByUuid(uuid);
    return this.utilisateursService.enrichUserComplete(profil);
  }
}
