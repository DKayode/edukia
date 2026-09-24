import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Protège le prestataire, pas nous.
 *
 * Chaque appel à `/paiements/:uuid/verifier` déclenche une requête sortante
 * vers Stripe, FedaPay ou KKiaPay. Une application mobile qui interroge en
 * boucle pendant que l'utilisateur regarde l'écran d'attente multiplierait
 * ces appels par le nombre de porteurs — et c'est le prestataire qui nous
 * couperait, pas l'inverse.
 *
 * La route exige un jeton : le compteur est donc toujours par compte, sans
 * repli par adresse IP. Deux étudiants derrière le même réseau ne se
 * pénalisent pas l'un l'autre.
 */
@Injectable()
export class PaiementVerificationRateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const utilisateurId = req.user?.utilisateurId;
    return utilisateurId !== undefined && utilisateurId !== null
      ? `utilisateur:${utilisateurId}`
      : `ip:${req.ip ?? 'inconnue'}`;
  }
}
