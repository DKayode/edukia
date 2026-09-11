import { ForbiddenException } from '@nestjs/common';
import { DecisionDroit, Feature } from './entitlement.service';
import { ResultatConsommation } from './quota.service';

/**
 * Refus pour profil incomplet (#259).
 *
 * Distinct du quota : le mobile doit router vers l'écran de profil, pas vers
 * celui de souscription — s'abonner ne débloquerait rien.
 */
export class ProfilIncompletException extends ForbiddenException {
  constructor(feature: Feature, decision: DecisionDroit) {
    super({
      statusCode: 403,
      error: 'PROFIL_INCOMPLET',
      message: 'Complétez votre profil pour accéder à cette ressource.',
      feature,
      ...(decision.quota ? { quota: decision.quota } : {}),
    });
  }
}

export class QuotaGratuitNonEligibleException extends ForbiddenException {
  constructor(feature: Feature) {
    super({
      statusCode: 403,
      error: 'FREE_QUOTA_NOT_ELIGIBLE',
      message: 'Les avantages gratuits ont deja ete attribues sur cet appareil. Un abonnement est requis.',
      feature,
    });
  }
}

/**
 * Refus par épuisement du quota gratuit, au même format que celui du guard
 * d'abonnement : `error` est le contrat machine que le mobile branche sur
 * l'écran de souscription, `message` est destiné à l'affichage.
 */
export class QuotaDepasseException extends ForbiddenException {
  constructor(feature: Feature, resultat: ResultatConsommation) {
    super({
      statusCode: 403,
      error: 'QUOTA_EXCEEDED',
      message:
        feature === Feature.KETSIA_AI
          ? `Vous avez utilisé Ketsia sur votre ressource gratuite. Un abonnement est requis pour continuer.`
          : `Vous avez consulté vos ${resultat.limit} ressources gratuites. Un abonnement est requis pour continuer.`,
      feature,
      quota: { used: resultat.used, limit: resultat.limit },
    });
  }
}
