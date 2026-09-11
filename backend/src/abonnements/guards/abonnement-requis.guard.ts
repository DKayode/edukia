import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_REQUISE } from '../decorators/requires-feature.decorator';
import { DecisionDroit, EntitlementService, Feature } from '../entitlement.service';

/**
 * Refuse une route quand l'utilisateur n'a pas le droit correspondant.
 *
 * Tant que `ABONNEMENTS_VERROU_ACTIF` vaut `false`, le guard LAISSE PASSER et se
 * contente de journaliser ce qu'il aurait refusé. Déployer le verrou avant que
 * #248 permette de s'abonner reviendrait à couper un accès existant sans
 * proposer d'issue ; ce mode « observation » donne la mesure de l'impact avant
 * de basculer.
 */
@Injectable()
export class AbonnementRequisGuard implements CanActivate {
  private readonly logger = new Logger(AbonnementRequisGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly entitlement: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<Feature>(FEATURE_REQUISE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const request = context.switchToHttp().getRequest();
    const utilisateurId = request.user?.utilisateurId;

    // Le rôle vient du JWT : le passer évite une requête SQL par appel gardé.
    const decision = await this.entitlement.check(utilisateurId, feature, request.user?.role);
    if (decision.allowed) return true;

    if (!this.entitlement.verrouActif(request.country)) {
      this.logger.warn(
        `[verrou éteint] accès qui aurait été refusé — feature=${feature} ` +
          `utilisateur=${utilisateurId ?? 'anonyme'} route=${request.method} ${request.url}`,
      );
      return true;
    }

    throw new ForbiddenException(this.corpsRefus(feature, decision));
  }

  /**
   * Corps stable, exploitable par le mobile : `error` est le contrat machine
   * (il ouvre l'écran de souscription), `message` est destiné à l'affichage.
   * Un 403 nu obligerait le client à deviner.
   */
  private corpsRefus(feature: Feature, decision: DecisionDroit) {
    return {
      statusCode: 403,
      // `error` est le contrat machine : le mobile route dessus. Un profil
      // incomplet mène à l'écran de profil, pas à celui de souscription.
      error:
        decision.reason === 'PROFIL_INCOMPLET'
          ? 'PROFIL_INCOMPLET'
          : decision.reason === 'QUOTA_EXCEEDED'
            ? 'QUOTA_EXCEEDED'
            : 'SUBSCRIPTION_REQUIRED',
      message:
        decision.reason === 'PROFIL_INCOMPLET'
          ? 'Complétez votre profil pour accéder à cette ressource.'
          : decision.reason === 'QUOTA_EXCEEDED'
            ? 'Vous avez atteint la limite gratuite. Un abonnement est requis pour continuer.'
            : 'Un abonnement actif est requis pour accéder à cette ressource.',
      feature,
      ...(decision.quota ? { quota: decision.quota } : {}),
    };
  }
}
