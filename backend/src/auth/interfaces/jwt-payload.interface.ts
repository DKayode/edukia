import { RoleType } from '../../utilisateurs/entities/utilisateur.entity';

export interface JwtPayload {
  sub: number;
  email: string;
  role: RoleType;
  /**
   * L'utilisateur a-t-il un abonnement actif au moment où le jeton a été émis ?
   *
   * Posé pour Ketsia, qui ne gère ni compte ni paiement et lit ce seul claim
   * pour décider si l'usage de l'IA est plafonné. Le nom est celui que Ketsia
   * attend par défaut (`AI_PREMIUM_CLAIM`), à plat et booléen : aucune
   * configuration n'est nécessaire de leur côté.
   *
   * ATTENTION, la valeur est une PHOTOGRAPHIE. Le jeton vit 24 h : souscrire
   * ne la met pas à jour, il faut un `POST /auth/refresh` — ou une nouvelle
   * connexion — pour que le claim bascule. Voir AuthService.
   *
   * Elle ne porte par ailleurs aucun pays : le jeton est volontairement
   * transnational, et le claim dit donc « abonné quelque part », pas « abonné
   * ici ».
   */
  abonnement_actif: boolean;
  iat?: number;
  exp?: number;
}