import { Controller, Post, Body, UseGuards, HttpCode, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto, LoginWithDeviceDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AppareilType } from './entities/refresh-token.entity';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentCountry } from '../common/decorators/current-country.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  async register(@CurrentCountry() pays: string, @Body() registerDto: RegisterDto) {
    return this.authService.register(pays, registerDto);
  }

  @Post('connexion')
  @HttpCode(200)
  async login(@Body() loginDto: LoginWithDeviceDto) {
    return this.authService.login(loginDto, loginDto.appareil);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshAccessToken(refreshTokenDto.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('deconnexion')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnexion de l\'utilisateur' })
  @ApiResponse({ status: 200, description: 'Déconnexion réussie' })
  async logout(@Request() req) {
    const userId = req.user?.utilisateurId;
    const token = req.headers.authorization?.split(' ')[1];

    // Ne fermer que la session de ce jeton : se déconnecter du web ne doit pas
    // déconnecter le téléphone. Les jetons sans `sid` ferment tout, comme avant.
    const sessionId = req.user?.sessionId;
    if (sessionId) {
      await this.authService.revokeSession(userId, sessionId);
    } else {
      await this.authService.revokeRefreshToken(userId);
    }

    if (token) {
      await this.authService.blacklistAccessToken(token);
    }

    return { message: 'Déconnexion réussie' };
  }

  // Pas de @HttpCode : ces routes répondent 201 depuis toujours. Les aligner sur
  // 200 « pour la cohérence » casserait tout client qui teste le statut exact.
  @Post('forgot-password')
  @ApiOperation({ summary: 'Demander un code de réinitialisation de mot de passe' })
  @ApiResponse({ status: 201, description: 'Réponse identique que l\'email existe ou non' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.authService.sendResetCode(forgotPasswordDto.email);
    return this.reponseEnvoiCode();
  }

  @Post('resend-reset-code')
  @ApiOperation({
    summary: 'Régénérer et renvoyer le code de réinitialisation',
    description:
      'Produit un NOUVEAU code et invalide le précédent. Un renvoi demandé avant la fin ' +
      'du délai de cadence, ou au-delà du plafond d\'envois, est absorbé sans erreur : la ' +
      'réponse ne doit rien révéler de l\'existence du compte.',
  })
  @ApiResponse({ status: 201, description: 'Réponse identique dans tous les cas' })
  async resendResetCode(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.authService.sendResetCode(forgotPasswordDto.email);
    return this.reponseEnvoiCode();
  }

  /**
   * Corps constant, sans lien avec l'issue réelle de la demande. Les durées
   * permettent au client de piloter son minuteur de renvoi sans interroger
   * l'état du compte.
   */
  private reponseEnvoiCode() {
    return {
      message: 'Si l\'email existe, un code a été envoyé',
      cooldown_seconds: AuthService.RESET_CODE_COOLDOWN_SECONDS,
      expires_in_seconds: AuthService.RESET_CODE_TTL_SECONDS,
    };
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Réinitialiser le mot de passe à partir du code reçu' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    await this.authService.resetPassword(resetPasswordDto);
    return { message: 'Mot de passe réinitialisé avec succès' };
  }
}