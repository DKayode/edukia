import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authentification facultative.
 *
 * Laisse toujours passer, mais renseigne `req.user` quand un jeton valide
 * accompagne la requête. Sert aux routes ouvertes à tous dont la réponse peut
 * être personnalisée pour qui est connecté — la validation d'un code
 * promotionnel avant même la création du compte, par exemple.
 *
 * Hérite de la stratégie `jwt` plutôt que de décoder le jeton à la main : les
 * contrôles qu'elle porte, dont la révocation, restent appliqués. Un jeton
 * absent, expiré ou révoqué donne simplement une requête anonyme, jamais un
 * 401.
 */
@Injectable()
export class JwtOptionnelGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
