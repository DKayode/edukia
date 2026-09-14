import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { ActiviteQueryDto } from './dto/activite-query.dto';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Pas de RolesGuard : chacun lit sa propre activité, et l'identité vient du
   * jeton, jamais d'un paramètre. Il n'y a donc rien à autoriser au-delà d'être
   * authentifié — et aucun moyen de demander celle d'un autre.
   */
  @Get('moi/activite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Activité Edukia de l'étudiant connecté (série journalière, série de connexions, compteurs, quotas)",
    description:
      "Alimente le tableau de bord « Pour toi » de l'app mobile. Appelé par le backend Kessiah, " +
      "qui relaie le jeton de l'étudiant et assemble ces données avec les siennes.",
  })
  @ApiResponse({
    status: 200,
    description: 'KPI personnels mobile : consultations académiques, série de connexions, soumissions, quotas consommés',
  })
  async getMonActivite(
    @Request() req,
    @Query() query: ActiviteQueryDto,
  ) {
    return this.dashboardService.getActivite(req.user.utilisateurId, query.jours);
  }
}
