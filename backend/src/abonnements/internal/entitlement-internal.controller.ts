import { CanActivate, Controller, ExecutionContext, Get, Injectable, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EntitlementService, Feature } from '../entitlement.service';
import { CurrentCountry } from '../../common/decorators/current-country.decorator';

/**
 * Clé propre au module, distincte de `PAYMENT_INTERNAL_API_KEY` : deux
 * consommateurs différents (Kessiah, le wallet) ne doivent pas partager un
 * secret — révoquer l'un couperait l'autre.
 */
@Injectable()
export class AbonnementInternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const attendu = this.config.get<string>('ABONNEMENT_INTERNAL_API_KEY');
    if (!attendu) return true;
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-internal-api-key'] !== attendu) {
      throw new UnauthorizedException('Clé interne invalide');
    }
    return true;
  }
}

/**
 * Contrôle de droit serveur à serveur.
 *
 * Kessiah doit vérifier le droit AVANT de produire une réponse : un client
 * mobile modifié qui n'appellerait pas la route de comptage contournerait
 * sinon le quota sans effort.
 */
@ApiTags('internal-abonnements')
@UseGuards(AbonnementInternalApiKeyGuard)
@Controller('internal/abonnements')
export class EntitlementInternalController {
  constructor(private readonly entitlement: EntitlementService) {}

  @Get('entitlement')
  @ApiHeader({ name: 'x-internal-api-key', required: false, description: 'Clé interne backend à backend' })
  @ApiOperation({ summary: 'Droit d’un utilisateur sur une fonctionnalité, pour un appel de service à service' })
  @ApiQuery({ name: 'userId', type: Number })
  @ApiQuery({ name: 'feature', enum: Feature })
  async check(
    @CurrentCountry() pays: string,
    @Query('userId') userId: string,
    @Query('feature') feature: Feature,
  ) {
    const decision = await this.entitlement.check(Number(userId), feature);
    return {
      allowed: decision.allowed,
      reason: decision.reason,
      ...(decision.quota ? { quota: decision.quota } : {}),
      verrou_actif: this.entitlement.verrouActif(pays),
    };
  }
}
