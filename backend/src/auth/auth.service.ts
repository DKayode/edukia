import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EntitlementService } from '../abonnements/entitlement.service';
import { Repository, LessThan } from 'typeorm';
import { UtilisateursService } from '../utilisateurs/utilisateurs.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { RefreshToken, AppareilType } from './entities/refresh-token.entity';
import { BlacklistedToken } from './entities/blacklisted-token.entity';
import { LoginEvent } from './entities/login-event.entity';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { DataSourceResolver } from '../config/data-source-resolver.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Durée de vie d'un code de réinitialisation. */
  static readonly RESET_CODE_TTL_SECONDS = 15 * 60;
  /** Délai imposé entre deux envois de code sur un même compte. */
  static readonly RESET_CODE_COOLDOWN_SECONDS = 60;
  /** Envois autorisés sur un cycle avant de forcer un nouveau départ. */
  static readonly RESET_CODE_MAX_ENVOIS = 5;
  /** Vérifications erronées tolérées avant invalidation du code. */
  static readonly RESET_CODE_MAX_TENTATIVES = 5;

  constructor(
    private readonly utilisateursService: UtilisateursService,
    private readonly jwtService: JwtService,
    private readonly resolver: DataSourceResolver,
    private readonly mailService: MailService,
    private readonly entitlement: EntitlementService,
  ) { }

  private get refreshTokenRepository(): Repository<RefreshToken> {
    return this.resolver.getRepository(RefreshToken);
  }

  private get loginEventRepository(): Repository<LoginEvent> {
    return this.resolver.getRepository(LoginEvent);
  }

  /**
   * Trace la connexion pour les KPI. En AJOUT SEUL, contrairement à
   * refresh_tokens dont la ligne est remplacée à chaque connexion.
   *
   * Best-effort : une écriture de statistique ne doit jamais faire échouer une
   * connexion. En cas d'erreur on journalise et on continue.
   */
  private async recordLoginEvent(
    userId: number,
    pays: string | undefined,
    appareil?: string,
    type: 'connexion' | 'refresh' = 'connexion',
  ) {
    try {
      await this.loginEventRepository.insert({
        utilisateur_id: userId,
        pays: pays || 'benin',
        appareil: appareil ?? null,
        type,
      });
    } catch (error) {
      this.logger.error(`Journalisation de la connexion échouée (utilisateur ${userId}): ${error.message}`);
    }
  }

  private get blacklistedTokenRepository(): Repository<BlacklistedToken> {
    return this.resolver.getRepository(BlacklistedToken);
  }

  async register(pays: string, registerDto: RegisterDto): Promise<Utilisateur> {
    this.logger.log(`Tentative d'inscription via /auth/register pour: ${registerDto.email} (pays=${pays})`);
    const hashedPassword = await bcrypt.hash(registerDto.mot_de_passe, 10);
    const user = await this.utilisateursService.inscription(pays, {
      nom: registerDto.nom,
      prenom: registerDto.prenom,
      email: registerDto.email,
      pseudo: registerDto.pseudo,
      mot_de_passe: hashedPassword, // Note: InscriptionDto expects plain password, but we hash here? check service
      role: registerDto.role,
      sexe: registerDto.sexe,
      age_group: registerDto.age_group,
      zone_residence: registerDto.zone_residence,
      situation_handicap: registerDto.situation_handicap,
      code_parrainage: registerDto.code_parrainage
    });
    this.logger.log(`Inscription réussie via /auth/register: ${user.email} (ID: ${user.id})`);
    return user;
  }

  /**
   * Le contenu du jeton d'accès, fabriqué en un seul endroit.
   *
   * `abonnement_actif` est là pour Ketsia, qui ne connaît ni les comptes ni les
   * paiements et lit ce seul claim pour décider si l'usage de l'IA est
   * plafonné. Nom, forme et type sont ceux qu'elle attend par défaut — à plat,
   * booléen — donc rien à configurer de son côté.
   *
   * C'est une PHOTOGRAPHIE, et le jeton vit 24 h : souscrire ne la met pas à
   * jour. Le client doit rafraîchir son jeton après un achat, sinon l'abonné
   * reste plafonné jusqu'à l'expiration. Le refresh repasse ici, c'est ce qui
   * rend la correction possible sans reconnexion.
   *
   * Le droit n'est jamais REFUSÉ sur la foi de ce claim côté Edukia : les
   * gardes interrogent la base à chaque appel. Le claim ne sert qu'aux services
   * tiers qui n'ont pas accès à cette base.
   */
  private async payloadJeton(user: { id: number; email: string; role: any }): Promise<JwtPayload> {
    let abonnementActif = false;
    try {
      abonnementActif = await this.entitlement.hasActiveSubscription(user.id);
    } catch (err) {
      // Une panne de lecture d'abonnement ne doit pas empêcher de se connecter.
      // On retombe sur `false` : un abonné verra son quota IA le temps d'un
      // rafraîchissement, ce qui est préférable à un refus de connexion.
      this.logger.warn(
        `Lecture de l'abonnement impossible pour le jeton de ${user.id} : ${err?.message ?? err}`,
      );
    }
    return { sub: user.id, email: user.email, role: user.role, abonnement_actif: abonnementActif };
  }

  async login(loginDto: LoginDto, appareil?: AppareilType): Promise<{ access_token: string; refresh_token: string }> {
    const identifier = loginDto.identifiant || loginDto.email;
    if (!identifier) {
      throw new UnauthorizedException('Identifiant (email ou pseudo) requis');
    }

    this.logger.log(`Tentative de connexion pour: ${identifier}`);
    const user = await this.utilisateursService.findByIdentifier(identifier);
    if (!user) {
      this.logger.warn(`Échec de connexion: utilisateur ${loginDto.email} introuvable`);
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.est_desactive) {
      this.logger.warn(`Connexion refusée: compte désactivé pour ${loginDto.email}`);
      throw new UnauthorizedException('Ce compte a été désactivé.');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.mot_de_passe, user.mot_de_passe);
    if (!isPasswordValid) {
      this.logger.warn(`Échec de connexion: mot de passe invalide pour ${loginDto.email}`);
      throw new UnauthorizedException('Identifiants invalides');
    }

    // Generate access token (1d). Country is intentionally not in the
    // payload — accounts are cross-country and switch scope via the
    // request's ?country= / body.pays without re-authenticating.
    const accessToken = this.jwtService.sign(await this.payloadJeton(user));

    // Generate refresh token (30 days)
    const refreshToken = await this.createRefreshToken(user.id, appareil || AppareilType.WEB);

    await this.recordLoginEvent(user.id, (user as any).pays, appareil || AppareilType.WEB);

    this.logger.log(`Connexion réussie: ${user.email} (ID: ${user.id}, Rôle: ${user.role})`);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async createRefreshToken(userId: number, appareil: AppareilType): Promise<string> {
    this.logger.log(`Création d'un refresh token pour utilisateur ID: ${userId}`);

    // Remove old refresh tokens for this user and device
    await this.refreshTokenRepository.delete({ utilisateur_id: userId, appareil });

    // Generate a random token
    const token = crypto.randomBytes(64).toString('hex');
    const hashedToken = await bcrypt.hash(token, 10);

    // Calculate expiration (1 month / 30 days)
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 30); // 30 days

    // Save to database
    const refreshToken = this.refreshTokenRepository.create({
      utilisateur_id: userId,
      token: hashedToken,
      date_expiration: expirationDate,
      appareil,
    });

    const savedToken = await this.refreshTokenRepository.save(refreshToken);
    this.logger.log(`Refresh token créé pour utilisateur ID: ${userId}, appareil: ${appareil}`);

    // Return the composite token (id:token)
    return `${savedToken.id}:${token}`;
  }

  async refreshAccessToken(refreshTokenString: string): Promise<{ access_token: string }> {
    this.logger.log('Tentative de rafraîchissement du token');

    // Expected format: "id:token"
    if (!refreshTokenString || !refreshTokenString.includes(':')) {
      // Fail Fast: Legacy tokens or invalid formats are rejected immediately
      this.logger.warn('Format de token invalide ou ancien token détecté (Fail Fast)');
      throw new UnauthorizedException('Session expirée, veuillez vous reconnecter');
    }

    const [idStr, plainTextToken] = refreshTokenString.split(':');
    const tokenId = parseInt(idStr, 10);

    if (isNaN(tokenId)) {
      throw new UnauthorizedException('Token ID invalide');
    }

    // FAST LOOKUP: Find specific token by ID (O(1))
    const validToken = await this.refreshTokenRepository.findOne({ where: { id: tokenId } });

    if (!validToken) {
      this.logger.warn(`Refresh token ID ${tokenId} introuvable`);
      throw new UnauthorizedException('Refresh token invalide');
    }

    // Verify hash
    const isValid = await bcrypt.compare(plainTextToken, validToken.token);
    if (!isValid) {
      this.logger.warn(`Signature invalide pour le refresh token ID ${tokenId}`);
      throw new UnauthorizedException('Refresh token invalide');
    }

    // Check if token is expired
    if (new Date() > validToken.date_expiration) {
      this.logger.warn(`Refresh token expiré pour utilisateur ID: ${validToken.utilisateur_id}`);
      await this.refreshTokenRepository.delete({ id: validToken.id });
      throw new UnauthorizedException('Refresh token expiré, veuillez vous reconnecter');
    }

    // Get user details
    const user = await this.utilisateursService.findOne(validToken.utilisateur_id.toString());
    if (!user) {
      this.logger.warn(`Utilisateur ID ${validToken.utilisateur_id} introuvable`);
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    // Generate new access token (cross-country, see login())
    const accessToken = this.jwtService.sign(await this.payloadJeton(user));

    // Une session renouvelée est une session active : sans cette ligne, seules
    // les ré-authentifications seraient comptées et les utilisateurs les plus
    // assidus — ceux qui ne se déconnectent jamais — seraient invisibles.
    await this.recordLoginEvent(user.id, (user as any).pays, validToken.appareil, 'refresh');

    this.logger.log(`Access token rafraîchi pour utilisateur: ${user.email} (ID: ${user.id})`);
    return { access_token: accessToken };
  }

  async revokeRefreshToken(userId: number, appareil?: AppareilType): Promise<void> {
    this.logger.log(`Révocation du refresh token pour utilisateur ID: ${userId}`);

    if (appareil) {
      await this.refreshTokenRepository.delete({ utilisateur_id: userId, appareil });
    } else {
      await this.refreshTokenRepository.delete({ utilisateur_id: userId });
    }

    this.logger.log(`Refresh token(s) révoqué(s) pour utilisateur ID: ${userId}`);
  }

  async blacklistAccessToken(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token) as any;
    if (!decoded || !decoded.exp) {
      return;
    }

    const date_expiration = new Date(decoded.exp * 1000);
    const blacklistedToken = this.blacklistedTokenRepository.create({
      token,
      date_expiration,
    });

    await this.blacklistedTokenRepository.save(blacklistedToken);
    this.logger.log(`Access token blacklisté jusqu'à: ${date_expiration}`);
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const blacklisted = await this.blacklistedTokenRepository.findOne({ where: { token } });
    return !!blacklisted;
  }

  async cleanupExpiredTokens(): Promise<void> {
    this.logger.log('Nettoyage des refresh tokens et tokens blacklistés expirés');

    const refreshResult = await this.refreshTokenRepository.delete({
      date_expiration: LessThan(new Date()),
    });

    const blacklistResult = await this.blacklistedTokenRepository.delete({
      date_expiration: LessThan(new Date()),
    });

    this.logger.log(`${refreshResult.affected || 0} refresh token(s) expiré(s) supprimé(s)`);
    this.logger.log(`${blacklistResult.affected || 0} token(s) blacklisté(s) expiré(s) supprimé(s)`);
  }

  async validateUser(userId: number): Promise<Utilisateur> {
    this.logger.log(`Validation de l'utilisateur ID: ${userId}`);
    return this.utilisateursService.findOne(userId.toString());
  }

  /**
   * Envoie — ou renvoie — un code de réinitialisation.
   *
   * `forgot-password` et `resend-reset-code` partagent ce chemin : un renvoi
   * n'est pas un cas particulier, c'est le même envoi avec un rang plus élevé
   * dans le cycle. Chaque envoi produit un NOUVEAU code et invalide le
   * précédent, ce que l'email dit explicitement — sans quoi l'utilisateur
   * impatient saisit le code du premier message et se voit refuser.
   *
   * Ne lève jamais : la réponse du contrôleur doit être identique que l'email
   * existe ou non, faute de quoi l'endpoint devient un oracle permettant
   * d'énumérer les comptes. Les refus (cadence, plafond, adresse inconnue,
   * panne SMTP) sont journalisés, pas renvoyés.
   */
  async sendResetCode(email: string): Promise<void> {
    const user = await this.utilisateursService.findByEmail(email);
    if (!user) {
      this.logger.warn(`Demande de code de réinitialisation pour email inconnu: ${email}`);
      return;
    }

    // La cadence porte sur le DERNIER ENVOI, jamais sur l'état du cycle : un code
    // invalidé (tentatives épuisées ou plafond d'envois atteint) ouvre un
    // nouveau cycle, et faire dépendre la cadence du cycle laisserait enchaîner
    // « 5 essais → nouveau code » sans aucune attente — soit un brute-force à
    // débit libre, doublé d'un envoi d'emails illimité.
    if (user.code_dernier_envoi) {
      const attenduMs = AuthService.RESET_CODE_COOLDOWN_SECONDS * 1000;
      const ecoule = Date.now() - new Date(user.code_dernier_envoi).getTime();
      if (ecoule < attenduMs) {
        this.logger.warn(
          `Envoi de code trop rapproché pour ${email} (${Math.round(ecoule / 1000)}s)`,
        );
        return;
      }
    }

    const envoisPrecedents = this.resetCycleEnCours(user) ? user.code_envois ?? 0 : 0;

    if (envoisPrecedents >= AuthService.RESET_CODE_MAX_ENVOIS) {
      // Le cycle est épuisé : on invalide plutôt que de laisser un code vivant
      // que plus aucun envoi ne peut remplacer.
      this.logger.warn(`Plafond d'envois de code atteint pour ${email}`);
      await this.utilisateursService.clearResetCode(user.id);
      return;
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    const expiration = new Date(Date.now() + AuthService.RESET_CODE_TTL_SECONDS * 1000);

    await this.utilisateursService.setResetCode(email, code, expiration, envoisPrecedents + 1);

    try {
      await this.mailService.sendResetCode(email, code, envoisPrecedents > 0);
    } catch (error) {
      // Une panne SMTP ne doit pas distinguer un email connu d'un inconnu.
      this.logger.error(`Échec d'envoi du code de réinitialisation à ${email}: ${error.message}`);
    }
  }

  /** Conservé pour la lisibilité des appelants ; `sendResetCode` fait le travail. */
  async forgotPassword(email: string): Promise<void> {
    return this.sendResetCode(email);
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { email, code, nouveau_mot_de_passe } = resetPasswordDto;

    const user = await this.utilisateursService.findByEmail(email);

    // Message unique sur tous les refus : distinguer « code faux » de « code
    // expiré » ou « compte inconnu » renseigne autant l'attaquant que l'usager.
    const refus = () => new UnauthorizedException('Code invalide ou expiré');

    if (!user || !user.digit_code) {
      throw refus();
    }

    // Une expiration NULL vaut expiré. `new Date() > null` est false en JS :
    // sans ce test explicite, une ligne à l'expiration absente accepterait son
    // code indéfiniment.
    if (!user.date_expiration_code || new Date() > new Date(user.date_expiration_code)) {
      throw refus();
    }

    if (!this.codesEgaux(user.digit_code, code)) {
      const tentatives = await this.utilisateursService.incrementResetAttempts(user.id);
      if (tentatives >= AuthService.RESET_CODE_MAX_TENTATIVES) {
        this.logger.warn(`Plafond de tentatives atteint pour ${email}, code invalidé`);
        await this.utilisateursService.clearResetCode(user.id);
      }
      throw refus();
    }

    const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await this.utilisateursService.updatePassword(user.id, hashedPassword);

    // Un mot de passe réinitialisé doit fermer les sessions ouvertes : sinon un
    // accès volé survit précisément à la manœuvre censée le couper.
    await this.revokeRefreshToken(user.id);

    this.logger.log(`Mot de passe réinitialisé pour ${email}`);
  }

  /** Un cycle expiré ne compte plus : ses envois ne pénalisent pas le suivant. */
  private resetCycleEnCours(user: Utilisateur): boolean {
    return Boolean(
      user.date_expiration_code && new Date() <= new Date(user.date_expiration_code),
    );
  }

  private codesEgaux(attendu: string, fourni: string): boolean {
    const a = Buffer.from(attendu, 'utf8');
    const b = Buffer.from(fourni, 'utf8');

    // `timingSafeEqual` exige des longueurs égales. Les égaliser par un digest
    // ferait passer une valeur issue du DTO par un hachage rapide — que
    // l'analyse statique lit, à raison, comme un mot de passe mal protégé.
    // Inutile ici : la longueur du code est publique (6 chiffres, annoncés dans
    // l'email), la divulguer ne révèle rien. Le temps constant n'a d'intérêt que
    // sur la comparaison des valeurs, et il est préservé.
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  }
}