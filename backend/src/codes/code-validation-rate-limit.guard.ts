import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Limite l'oracle de validation : par compte lorsqu'un jeton accompagne la
 * requête, par adresse IP sinon.
 *
 * La route étant ouverte sans compte, le repli par IP n'est plus théorique :
 * c'est lui qui protège contre la découverte de codes par tâtonnement.
 */
@Injectable()
export class CodeValidationRateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const utilisateurId = req.user?.utilisateurId;
    if (utilisateurId !== undefined && utilisateurId !== null) {
      return `utilisateur:${utilisateurId}`;
    }

    // Appel anonyme : on retombe sur l'adresse. Moins précis — un réseau
    // partagé compte pour un —, mais c'est la seule prise disponible, et sans
    // elle un code court se devine en quelques milliers d'essais.
    return `ip:${req.ip ?? 'inconnue'}`;
  }
}
