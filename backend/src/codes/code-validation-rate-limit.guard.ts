import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Limite l'oracle de validation par compte authentifié, indépendamment du proxy. */
@Injectable()
export class CodeValidationRateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const utilisateurId = req.user?.utilisateurId;
    if (utilisateurId !== undefined && utilisateurId !== null) {
      return `utilisateur:${utilisateurId}`;
    }

    // JwtAuthGuard s'exécute avant ce guard. Ce repli conserve toutefois une
    // limitation si le guard est réutilisé par erreur sur une route publique.
    return `ip:${req.ip ?? 'inconnue'}`;
  }
}
