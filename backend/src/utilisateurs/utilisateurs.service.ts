import { Injectable, ConflictException, NotFoundException, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository, Brackets, LessThan, IsNull } from 'typeorm';
import { RoleType, Utilisateur } from './entities/utilisateur.entity';
import { Prestataire } from '../prestataires/entities/prestataire.entity';
import { Recruteur } from '../recruteurs/entities/recruteur.entity';
import { Departement } from '../departements/entities/departement.entity';
import { Ville } from '../villes/entities/ville.entity';
import { TypeProfil } from '../type-profils/entities/type-profil.entity';
import { DataSourceResolver } from '../config/data-source-resolver.service';
import { CountryContextService } from '../config/country-context.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FilterUtilisateurDto } from './dto/filter-utilisateur.dto';
import { InscriptionDto } from './dto/inscription.dto';
import { MajUtilisateurDto } from './dto/maj-utilisateur.dto';
import { ValidateEmailDto } from './dto/verify-email.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginationResponse } from '../common/interfaces/pagination-response.interface';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';


import { FichiersService } from 'src/fichiers/fichiers.service';
import { TypeFichier } from 'src/fichiers/entities/fichier.entity';
import { MailService } from '../mail/mail.service';
import { IsEmail } from 'class-validator';
import * as crypto from 'crypto';
import { DeviceCreditEligibilityService } from '../device-credits/device-credit-eligibility.service';

@Injectable()
export class UtilisateursService {
  private readonly logger = new Logger(UtilisateursService.name);

  constructor(
    private readonly resolver: DataSourceResolver,
    private readonly context: CountryContextService,
    private readonly fichiersService: FichiersService,
    private readonly firebaseService: FirebaseService,
    private readonly mailService: MailService,
    private readonly deviceCredits: DeviceCreditEligibilityService,
  ) { }

  private get utilisateursRepository(): Repository<Utilisateur> {
    return this.resolver.getRepository(Utilisateur);
  }

  // geo-profile: repos for validating the profile pays -> departement -> ville cascade
  private get departementRepository(): Repository<Departement> {
    return this.resolver.getRepository(Departement);
  }
  private get villeRepository(): Repository<Ville> {
    return this.resolver.getRepository(Ville);
  }

  // geo-profile: validate departement_id/ville_id against the user's pays before save.
  // Throws 400 (not 404). Accepts explicit null to clear. Only runs for keys
  // actually present on the DTO, so unrelated profile updates are untouched.
  private async validateGeo(
    userPays: string,
    dto: { departement_id?: string | null; ville_id?: string | null },
    user: Utilisateur,
  ): Promise<void> {
    const hasDept = dto.departement_id !== undefined;
    const hasVille = dto.ville_id !== undefined;
    if (!hasDept && !hasVille) return;

    const finalDeptId = hasDept ? dto.departement_id : user.departement_id;
    const finalVilleId = hasVille ? dto.ville_id : user.ville_id;

    if (finalDeptId != null) {
      const departement = await this.departementRepository.findOne({
        where: { id: finalDeptId, pays: userPays },
      });
      if (!departement) {
        throw new BadRequestException(
          `Le département ${finalDeptId} n'existe pas pour ce pays`,
        );
      }
    }

    if (finalVilleId != null) {
      if (finalDeptId == null) {
        throw new BadRequestException(
          'Une ville ne peut être définie sans département',
        );
      }
      const ville = await this.villeRepository.findOne({
        where: { id: finalVilleId },
      });
      if (!ville || ville.departement_id !== finalDeptId) {
        throw new BadRequestException(
          `La ville ${finalVilleId} n'appartient pas au département ${finalDeptId}`,
        );
      }
    }
  }

  /**
   * Expose le chemin public de la photo de profil (`profil_photo_path`) sous la
   * clé `profil` sur chaque utilisateur renvoyé par l'API. Aucun
   * ClassSerializerInterceptor n'étant en place, `profil` doit être une vraie
   * propriété de l'objet (et non un getter de prototype) pour apparaître dans le
   * JSON. La valeur est renvoyée verbatim ; le fallback `''` reflète simplement
   * le défaut de la colonne (NOT NULL, default '') quand l'instance en mémoire
   * n'a pas encore été hydratée (ex. juste après une insertion).
   */
  private withProfil<T extends Utilisateur>(user: T): T & { profil: string } {
    return Object.assign(user, { profil: user.profil_photo_path ?? '' });
  }

  // geo-profile: single source of truth for the complete user JSON shape returned by
  // GET /utilisateurs (list), /utilisateurs/profil and /utilisateurs/:uuid — withProfil +
  // geo {uuid,nom} + derived age + verify/prestataire/recruteur booleans. The caller must
  // load the departement/ville relations (findOne/findByUuid/findAll all do).
  // PERF NOTE: 4 lookups per user (isEmailVerified/isPrestataire/isRecruteur + type_profil)
  // => N+1 on the list (4 x page_size). Acceptable at the current default page size; batch if it grows.
  async enrichUserComplete<T extends Utilisateur>(user: T) {
    const [{ isVerified }, { isPrestataire }, { isRecruteur }, typeProfil] = await Promise.all([
      this.isEmailVerified(user.id),
      this.isPrestataire(user.id),
      this.isRecruteur(user.id),
      this.getTypeProfilForProfil(user.id),
    ]);
    const result: any = {
      ...this.withProfil(user),
      departement: user.departement ? { uuid: user.departement.id, nom: user.departement.nom } : null,
      ville: user.ville ? { uuid: user.ville.id, nom: user.ville.nom } : null,
      // hotfix: tranche d'âge remplace date_naissance/age dans la réponse profil.
      age_group: (user as any).age_group ?? null,
      isEmailVerified: isVerified,
      isPrestataire,
      isRecruteur,
      // type-profils: id brut + objet résolu, sur les 3 endpoints (liste / profil / :uuid).
      type_profil_id: typeProfil.type_profil_id,
      type_profil: typeProfil.type_profil,
    };
    // raw ids redundant now that departement/ville are {uuid,nom}.
    delete result.departement_id;
    delete result.ville_id;
    return result;
  }

  async findByEmail(email: string) {
    this.logger.log(`Recherche de l'utilisateur par email: ${email}`);
    return this.utilisateursRepository.findOne({
      where: { email }
    });
  }

  async findByIdentifier(identifier: string) {
    this.logger.log(`Recherche de l'utilisateur par identifiant (email ou pseudo): ${identifier}`);
    return this.utilisateursRepository.findOne({
      where: [
        { email: identifier },
        { pseudo: identifier }
      ]
    });
  }

  async inscription(
    pays: string,
    inscriptionDto: InscriptionDto,
    options: { trustedBackOffice?: boolean } = {},
  ) {
    this.logger.log(`Tentative d'inscription pour: ${inscriptionDto.email} (pays=${pays})`);

    if (inscriptionDto.role === RoleType.ADMIN && !options.trustedBackOffice) {
      throw new ForbiddenException('La creation d\'un administrateur exige un compte administrateur');
    }

    // Never spread an attestation token into the persisted user or API response.
    const { device_attestation: deviceAttestation, ...donneesInscription } = inscriptionDto;

    // Check if email already exists
    const existingUser = await this.utilisateursRepository.findOne({
      where: { email: inscriptionDto.email },
    });

    if (existingUser) {
      // Check if user is soft deleted (marked for deletion)
      if (existingUser.est_desactive && existingUser.date_suppression_prevue) {
        this.logger.log(`Réactivation du compte pour: ${inscriptionDto.email}`);

        // Hash new password
        const hashedPassword = await bcrypt.hash(inscriptionDto.mot_de_passe, 10);

        // Update user properties
        const updatedUser = this.utilisateursRepository.merge(existingUser, {
          ...donneesInscription,
          mot_de_passe: hashedPassword,
          est_desactive: false,
          date_suppression_prevue: null,
          code_parrainage_saisi: inscriptionDto.code_parrainage ?? existingUser.code_parrainage_saisi,
        });

        // Save reactivated user
        const savedUser = await this.utilisateursRepository.save(updatedUser);
        this.logger.log(`Utilisateur réactivé avec succès: ${savedUser.email} (ID: ${savedUser.id})`);

        // Remove password from response
        delete savedUser.mot_de_passe;
        return this.withProfil(savedUser);
      }

      this.logger.warn(`Échec de l'inscription: email ${inscriptionDto.email} déjà utilisé et compte actif`);
      throw new ConflictException('Un utilisateur avec cet email existe déjà');
    }

    // Check if pseudo already exists (if provided)
    if (inscriptionDto.pseudo) {
      const existingUserPseudo = await this.utilisateursRepository.findOne({
        where: { pseudo: inscriptionDto.pseudo },
      });

      if (existingUserPseudo) {
        this.logger.warn(`Échec de l'inscription: pseudo ${inscriptionDto.pseudo} déjà utilisé`);
        throw new ConflictException('Un utilisateur avec ce pseudo existe déjà');
      }
    }

    // Check if pseudo already exists (if provided)
    if (inscriptionDto.pseudo) {
      const existingUserPseudo = await this.utilisateursRepository.findOne({
        where: { pseudo: inscriptionDto.pseudo },
      });

      if (existingUserPseudo) {
        this.logger.warn(`Échec de l'inscription: pseudo ${inscriptionDto.pseudo} déjà utilisé`);
        throw new ConflictException('Un utilisateur avec ce pseudo existe déjà');
      }
    }

    // Verifier le parrain si le code est fourni
    let parrain: Utilisateur | null = null;
    if (inscriptionDto.code_parrainage) {
      this.logger.log(`Recherche du parrain avec le code: ${inscriptionDto.code_parrainage}`);
      parrain = await this.utilisateursRepository.findOne({
        where: { mon_code_parrainage: inscriptionDto.code_parrainage }
      });
      if (parrain) {
        this.logger.log(`Parrain trouvé: ${parrain.email}`);
      } else {
        this.logger.warn(`Aucun parrain trouvé avec le code: ${inscriptionDto.code_parrainage}`);
      }
    }

    const preparedDeviceCredit = options.trustedBackOffice
      ? null
      : await this.deviceCredits.prepare(deviceAttestation, { email: inscriptionDto.email, pays });

    // Hash password before saving
    const hashedPassword = await bcrypt.hash(inscriptionDto.mot_de_passe, 10);

    // Unicité vérifiée contre le REGISTRE (#247), pas seulement contre les
    // utilisateurs : un code généré pouvait tomber sur un code promo existant,
    // et le même texte désignait alors deux choses — l'insertion au registre
    // étant best-effort, la collision passait en silence.
    let monCodeParrainage = this.generateReferralCode();
    while (await this.codeDejaPris(monCodeParrainage)) {
      monCodeParrainage = this.generateReferralCode();
    }

    // Create new user with hashed password
    const newUser = this.utilisateursRepository.create({
      ...donneesInscription,
      pays,
      mot_de_passe: hashedPassword,
      parrain: parrain,
      code_parrainage_saisi: inscriptionDto.code_parrainage ?? null,
      mon_code_parrainage: monCodeParrainage,
      uuid: crypto.randomUUID(),
      // Fail closed until the device decision has been persisted below.
      quota_gratuit_eligible: false,
    });

    // Save user
    const savedUser = await this.utilisateursRepository.save(newUser);

    const quotaDecision = options.trustedBackOffice
      ? { eligible: true, reason: 'TRUSTED_BACK_OFFICE' }
      : await this.deviceCredits.allocate(savedUser.id, pays, preparedDeviceCredit);
    savedUser.quota_gratuit_eligible = quotaDecision.eligible;
    try {
      await this.utilisateursRepository.update(savedUser.id, {
        quota_gratuit_eligible: quotaDecision.eligible,
      });
    } catch {
      // The row was created fail-closed. A transient update failure must not
      // turn a successful signup into a retry that collides with its own email.
      savedUser.quota_gratuit_eligible = false;
      this.logger.error(`Mise a jour eligibilite quota echouee: utilisateur=${savedUser.id}`);
    }

    // Registre unifié des codes (#247). Best-effort : l'inscription ne doit pas
    // échouer parce que le registre est indisponible — la résolution à l'achat
    // retombe alors sur `mon_code_parrainage`.
    void this.enregistrerCodeDansRegistre(savedUser.id, monCodeParrainage, pays);
    this.logger.log(`Utilisateur créé avec succès: ${savedUser.email} (ID: ${savedUser.id}, Rôle: ${savedUser.role}, Code Parrainage: ${savedUser.mon_code_parrainage})`);

    // Remove password from response
    delete savedUser.mot_de_passe;
    return this.withProfil(savedUser);
  }

  /** Un code est pris s'il existe chez un utilisateur OU dans le registre. */
  private async codeDejaPris(code: string): Promise<boolean> {
    const majuscule = String(code).toUpperCase();
    if (await this.utilisateursRepository.findOne({ where: { mon_code_parrainage: code } })) return true;
    try {
      const [r] = await this.utilisateursRepository.query(
        `SELECT 1 FROM codes WHERE upper(code) = $1 LIMIT 1`,
        [majuscule],
      );
      return !!r;
    } catch {
      // Registre indisponible : on ne bloque pas une inscription pour autant.
      return false;
    }
  }

  /**
   * Enregistre le code au registre unifié avec son effet COMMISSION.
   *
   * Best-effort et jamais attendu : l'inscription ne doit pas échouer parce que
   * le registre est indisponible. La résolution à l'achat retombe alors sur
   * `mon_code_parrainage`.
   */
  private async enregistrerCodeDansRegistre(utilisateurId: number, code: string, pays: string): Promise<void> {
    try {
      const [ligne] = await this.utilisateursRepository.query(
        `INSERT INTO codes (pays, code, origine, proprietaire_id, usage_max_total, usage_max_par_utilisateur, est_actif)
         VALUES ($1, $2, 'INSCRIPTION', $3, NULL, 1, true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [pays ?? 'benin', String(code).toUpperCase(), utilisateurId],
      );
      if (ligne?.id) {
        await this.utilisateursRepository.query(
          `INSERT INTO code_effets (code_id, effet) VALUES ($1, 'COMMISSION') ON CONFLICT DO NOTHING`,
          [ligne.id],
        );
      }
    } catch (err) {
      this.logger.warn(`Code ${code} non enregistré dans le registre: ${err?.message ?? err}`);
    }
  }

  private generateReferralCode(): string {
    // Generate a code like "REF-A1B2C" or "KAYODE123"
    // Using simple alphanumeric random string
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const length = 6;
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async generateMissingReferralCodes(): Promise<{ updated: number }> {
    const users = await this.utilisateursRepository.find({
      where: { mon_code_parrainage: IsNull() },
    });

    let updatedCount = 0;
    for (const user of users) {
      // Reuse existing generation logic (which checks uniqueness if we use the same pattern, 
      // but generateReferralCode() specifically returns a string. We need to ensure uniqueness loop here too or inside helper.
      // The helper I wrote earlier is private and just returns a string. 
      // Ideally I should refactor inscription's uniqueness logic into a helper, but for now I'll duplicate the simple uniqueness check or improve helper.
      // Actually inscription logic does: generate -> check DB -> retry.

      let code = this.generateReferralCode();
      while (await this.utilisateursRepository.findOne({ where: { mon_code_parrainage: code } })) {
        code = this.generateReferralCode();
      }

      user.mon_code_parrainage = code;
      await this.utilisateursRepository.save(user);
      updatedCount++;
    }

    this.logger.log(`Backfill complete: Generated referral codes for ${updatedCount} users.`);
    return { updated: updatedCount };
  }

  async generateMissingUuids(): Promise<{ updated: number }> {
    const users = await this.utilisateursRepository.find({
      where: { uuid: IsNull() },
    });

    let updatedCount = 0;
    for (const user of users) {
      user.uuid = crypto.randomUUID();
      await this.utilisateursRepository.save(user);
      updatedCount++;
    }

    this.logger.log(`Backfill complete: Generated UUIDs for ${updatedCount} users.`);
    return { updated: updatedCount };
  }

  async getReferralCode(id: number): Promise<{ code_parrainage: string }> {
    const user = await this.utilisateursRepository.findOne({
      where: { id },
      select: ['mon_code_parrainage'],
    });
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }
    return { code_parrainage: user.mon_code_parrainage };
  }

  async findAll(pays: string, filterDto: FilterUtilisateurDto): Promise<PaginationResponse<Utilisateur>> {
    const { page = 1, limit = 10, search, role, activated, sort_by, sort_order, parrain_id } = filterDto;
    this.logger.log(`Récupération des utilisateurs (pays=${pays}) - Page: ${page}, Limite: ${limit}, Search: ${search}, Role: ${role}, Activated: ${activated}, SortBy: ${sort_by}, Order: ${sort_order}, ParrainId: ${parrain_id}`);

    const queryBuilder = this.utilisateursRepository.createQueryBuilder('utilisateur')
      .leftJoinAndSelect('utilisateur.etablissement', 'etablissement')
      .leftJoinAndSelect('utilisateur.filiere', 'filiere')
      .leftJoinAndSelect('utilisateur.niveau_etude', 'niveau_etude')
      // geo-profile: join dept/ville so the list can expose them (shaped {id,nom} below)
      .leftJoinAndSelect('utilisateur.departement', 'departement')
      .leftJoinAndSelect('utilisateur.ville', 'ville')
      .loadRelationCountAndMap('utilisateur.filleulsCount', 'utilisateur.filleuls')
      .select(['utilisateur.id', 'utilisateur.nom', 'utilisateur.prenom', 'utilisateur.email', 'utilisateur.pseudo', 'utilisateur.uuid', 'utilisateur.photo', 'utilisateur.profil_photo_path', 'utilisateur.profil_photo_extension', 'utilisateur.sexe', 'utilisateur.telephone', 'utilisateur.role', 'utilisateur.pays', 'utilisateur.est_desactive', 'utilisateur.date_suppression_prevue', 'utilisateur.date_creation', 'utilisateur.mon_code_parrainage', 'utilisateur.code_parrainage_saisi', 'utilisateur.departement_id', 'utilisateur.ville_id', 'utilisateur.age_group', 'utilisateur.zone_residence', 'utilisateur.situation_handicap', 'etablissement', 'filiere', 'niveau_etude', 'departement', 'ville'])
      .where('utilisateur.pays = :pays', { pays })
      .skip((page - 1) * limit)
      .take(limit);

    // Sorting
    if (sort_by === 'date_creation') {
      queryBuilder.orderBy('utilisateur.date_creation', sort_order || 'DESC');
    } else if (sort_by === 'filleuls') {
      queryBuilder.addSelect((subQuery) => {
        return subQuery
          .select('COUNT(sub_u.id)', 'count')
          .from(Utilisateur, 'sub_u')
          .where('sub_u.parrain_id = utilisateur.id');
      }, 'filleuls_count');
      queryBuilder.orderBy('filleuls_count', sort_order || 'DESC');
    } else {
      // Default sort by ID (or whatever was default before, usually ID implicitly or creation order)
      queryBuilder.orderBy('utilisateur.id', sort_order || 'ASC');
    }

    if (role) {
      queryBuilder.andWhere('utilisateur.role = :role', { role });
    }

    if (activated !== undefined) {
      // activated = true => est_desactive = false
      // activated = false => est_desactive = true
      queryBuilder.andWhere('utilisateur.est_desactive = :estDesactive', { estDesactive: !activated });
    }

    if (parrain_id) {
      queryBuilder.andWhere('utilisateur.parrain_id = :parrainId', { parrainId: parrain_id });
    }

    if (search) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('unaccent(utilisateur.nom) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(utilisateur.email) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(utilisateur.pseudo) ILIKE unaccent(:search)', { search: `%${search}%` });
        }),
      );
    }

    const [users, total] = await queryBuilder.getManyAndCount();

    this.logger.log(`${users.length} utilisateur(s) trouvé(s) sur ${total} total`);

    // geo-profile: unify the list shape with /profil + /:uuid via enrichUserComplete
    // (adds geo {uuid,nom}, age, and the 3 booleans). filleulsCount rides along via withProfil.
    const data = await Promise.all(users.map((user) => this.enrichUserComplete(user)));

    return {
      data: data as any,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Comptes partageant un même token FCM (= même appareil / installation).
   * Ne renvoie que les tokens portés par plus d'un compte, groupés et paginés
   * par groupe (le token est la clé). Chaque groupe embarque ses comptes — les
   * groupes sont petits (2-8). Scopé par pays comme le reste de l'admin.
   */
  async findSharedDevices(pays: string, filterDto: FilterUtilisateurDto) {
    const page = Number(filterDto.page ?? 1);
    const limit = Number(filterDto.limit ?? 10);
    const offset = (page - 1) * limit;
    const search = filterDto.search?.trim();

    const params: any[] = [pays];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      // A group matches if ANY of its accounts matches the term.
      searchClause = `AND EXISTS (
        SELECT 1 FROM utilisateurs s
        WHERE s.fcm_token = u.fcm_token AND s.pays = $1
          AND (unaccent(s.email) ILIKE unaccent($2)
            OR unaccent(coalesce(s.nom, '')) ILIKE unaccent($2)
            OR unaccent(coalesce(s.prenom, '')) ILIKE unaccent($2)
            OR unaccent(coalesce(s.pseudo, '')) ILIKE unaccent($2)))`;
    }

    const groupClause = `
      FROM utilisateurs u
      WHERE u.pays = $1 AND NULLIF(TRIM(u.fcm_token), '') IS NOT NULL ${searchClause}
      GROUP BY u.fcm_token
      HAVING COUNT(*) > 1`;

    const [{ n: total }] = await this.utilisateursRepository.query(
      `SELECT COUNT(*)::int n FROM (SELECT u.fcm_token ${groupClause}) g`,
      params,
    );

    const groups = await this.utilisateursRepository.query(
      `SELECT u.fcm_token AS fcm_token, COUNT(*)::int AS accounts_count
       ${groupClause}
       ORDER BY accounts_count DESC, u.fcm_token
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const tokens = groups.map((g: any) => g.fcm_token);
    const byToken: Record<string, any[]> = {};
    if (tokens.length) {
      const accounts = await this.utilisateursRepository.query(
        `SELECT id, nom, prenom, email, pseudo, pays, role, uuid, fcm_token, verifier, date_creation
         FROM utilisateurs
         WHERE pays = $1 AND fcm_token = ANY($2)
         ORDER BY date_creation ASC`,
        [pays, tokens],
      );
      for (const a of accounts) {
        const tok = a.fcm_token;
        delete a.fcm_token; // redundant per-account — it's the group key
        (byToken[tok] ??= []).push(a);
      }
    }

    const data = groups.map((g: any) => ({
      fcm_token: g.fcm_token,
      accounts_count: g.accounts_count,
      accounts: byToken[g.fcm_token] ?? [],
    }));

    return { data, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) };
  }

  async findOne(id: string) {
    this.logger.log(`Recherche de l'utilisateur avec ID: ${id}`);
    const user = await this.utilisateursRepository.findOne({
      where: { id: parseInt(id) },
      select: ['id', 'nom', 'prenom', 'email', 'pseudo', 'uuid', 'photo', 'profil_photo_path', 'profil_photo_extension', 'sexe', 'telephone', 'role', 'mon_code_parrainage', 'code_parrainage_saisi', 'departement_id', 'ville_id',
        // geo-profile (D4): previously-dropped profile fields
        'pays', 'age_group', 'zone_residence', 'situation_handicap', 'date_creation',
        // geo-profile: match the unified list shape (enrichUserComplete)
        'est_desactive', 'date_suppression_prevue'],
      relations: ['etablissement', 'filiere', 'niveau_etude', 'departement', 'ville'],
    });

    if (!user) {
      this.logger.warn(`Utilisateur avec ID ${id} introuvable`);
      throw new NotFoundException('Utilisateur non trouvé');
    }

    this.logger.log(`Utilisateur trouvé: ${user.email} (ID: ${user.id})`);
    return this.withProfil(user);
  }

  async findByUuid(uuid: string) {
    this.logger.log(`Recherche de l'utilisateur avec UUID: ${uuid}`);
    const user = await this.utilisateursRepository.findOne({
      where: { uuid },
      select: ['id', 'nom', 'prenom', 'email', 'pseudo', 'uuid', 'photo', 'profil_photo_path', 'profil_photo_extension', 'sexe', 'telephone', 'role', 'mon_code_parrainage', 'code_parrainage_saisi', 'departement_id', 'ville_id',
        // geo-profile (D4): previously-dropped profile fields
        'pays', 'age_group', 'zone_residence', 'situation_handicap', 'date_creation',
        // geo-profile: match the unified list shape (enrichUserComplete)
        'est_desactive', 'date_suppression_prevue'],
      relations: ['etablissement', 'filiere', 'niveau_etude', 'departement', 'ville'],
    });

    if (!user) {
      this.logger.warn(`Utilisateur avec UUID ${uuid} introuvable`);
      throw new NotFoundException('Utilisateur non trouvé');
    }

    this.logger.log(`Utilisateur trouvé: ${user.email} (UUID: ${user.uuid})`);
    return this.withProfil(user);
  }

  async update(id: string, majUtilisateurDto: MajUtilisateurDto) {
    this.logger.log(`Mise à jour de l'utilisateur ID: ${id}`);
    const user = await this.utilisateursRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!user) {
      this.logger.warn(`Mise à jour échouée: utilisateur ID ${id} introuvable`);
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // geo-profile: enforce the pays -> departement -> ville cascade
    await this.validateGeo(user.pays, majUtilisateurDto, user);

    // Type de profil : valider qu'il existe ET appartient au pays de l'utilisateur.
    // `undefined` = champ absent (on n'y touche pas) ; `null` = retirer l'assignation.
    if (majUtilisateurDto.type_profil_id !== undefined && majUtilisateurDto.type_profil_id !== null) {
      const typeProfil = await this.resolver.getRepository(TypeProfil).findOne({
        where: { id: majUtilisateurDto.type_profil_id },
      });
      if (!typeProfil) {
        throw new NotFoundException(`Type de profil ${majUtilisateurDto.type_profil_id} non trouvé`);
      }
      if (typeProfil.pays !== user.pays) {
        throw new BadRequestException(
          `Le type de profil ${majUtilisateurDto.type_profil_id} n'appartient pas à votre pays`,
        );
      }
    }

    // Update user
    Object.assign(user, majUtilisateurDto);
    const updatedUser = await this.utilisateursRepository.save(user);
    this.logger.log(`Utilisateur mis à jour avec succès: ${updatedUser.email} (ID: ${updatedUser.id})`);

    // Remove password from response
    delete updatedUser.mot_de_passe;
    return this.withProfil(updatedUser);
  }

  async isEmailVerified(userId: number): Promise<{ isVerified: boolean }> {
    const user = await this.utilisateursRepository.findOne({ where: { id: userId }, select: ['verifier'] });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');
    return { isVerified: user.verifier || false };
  }

  async isPrestataire(userId: number): Promise<{ isPrestataire: boolean }> {
    const prestataire = await this.resolver.getRepository(Prestataire).findOne({
      where: { utilisateur_id: userId },
    });
    return { isPrestataire: !!prestataire };
  }

  async isRecruteur(userId: number): Promise<{ isRecruteur: boolean }> {
    const recruteur = await this.resolver.getRepository(Recruteur).findOne({
      where: { utilisateur_id: userId },
    });
    return { isRecruteur: !!recruteur };
  }

  /**
   * Résout le type de profil d'un utilisateur pour la réponse GET /utilisateurs/profil.
   * Renvoie l'id brut (`type_profil_id`) + l'objet `type_profil`
   * { id, uuid, titre, sous_titre, icone } (ou null si non assigné). `icone` est
   * l'emoji ; `icone_path` (R2, dormant) est conservé pour compat.
   */
  async getTypeProfilForProfil(userId: number): Promise<{
    type_profil_id: number | null;
    type_profil: { id: number; uuid: string; titre: string; sous_titre: string | null; icone: string | null; icone_path: string | null } | null;
  }> {
    const user = await this.utilisateursRepository.findOne({
      where: { id: userId },
      select: ['id', 'type_profil_id'],
    });
    const typeProfilId = user?.type_profil_id ?? null;
    if (!typeProfilId) {
      return { type_profil_id: null, type_profil: null };
    }
    const typeProfil = await this.resolver.getRepository(TypeProfil).findOne({
      where: { id: typeProfilId },
      select: ['id', 'uuid', 'titre', 'sous_titre', 'icone', 'icone_path'],
    });
    return {
      type_profil_id: typeProfilId,
      type_profil: typeProfil
        ? {
          id: typeProfil.id,
          uuid: typeProfil.uuid,
          titre: typeProfil.titre,
          sous_titre: typeProfil.sous_titre ?? null,
          icone: typeProfil.icone ?? null,
          icone_path: typeProfil.icone_path ?? null,
        }
        : null,
    };
  }

  async verifyEmail(email: string) {
    this.logger.log(`Demande de vérification de l\'email pour: ${email}`);
    const user = await this.utilisateursRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Generate a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiration to 1 day from now
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + 1);

    user.digit_code = code;
    user.date_expiration_code = expiration;
    await this.utilisateursRepository.save(user);

    await this.mailService.sendVerifyEmailCode(email, code);

    this.logger.log(`Code de vérification envoyé à l\\'utilisateur: ${email}`);
    return { message: 'Code de vérification envoyé avec succès' };
  }

  async validateEmail(validateEmailDto: ValidateEmailDto) {
    const { email, code } = validateEmailDto;

    this.logger.log(`Validation de l\'email pour: ${email}`);
    const user = await this.utilisateursRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.digit_code !== code) {
      user.verifier = false;
      await this.utilisateursRepository.save(user);
      throw new BadRequestException('Code de validation incorrect');
    }

    if (new Date() > user.date_expiration_code) {
      user.verifier = false;
      await this.utilisateursRepository.save(user);
      throw new BadRequestException('Le code de validation a expiré');
    }

    user.verifier = true;
    user.digit_code = null;
    user.date_expiration_code = null;
    await this.utilisateursRepository.save(user);

    this.logger.log(`Email validé avec succès pour: ${email}`);
    return { message: 'Email vérifié avec succès', verifier: true };
  }
  async remove(id: string) {
    this.logger.log(`Tentative de suppression de l'utilisateur ID: ${id}`);
    const user = await this.utilisateursRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!user) {
      this.logger.warn(`Suppression échouée: utilisateur ID ${id} introuvable`);
      throw new NotFoundException('Utilisateur non trouvé');
    }

    await this.utilisateursRepository.remove(user);
    this.logger.log(`Utilisateur supprimé avec succès: ${user.email} (ID: ${id})`);
    return { message: 'Utilisateur supprimé avec succès' };
  }

  /**
   * Écrit un nouveau code de réinitialisation et repart d'un cycle propre :
   * le compteur de tentatives est remis à zéro, celui des envois est porté par
   * l'appelant (il connaît le rang de l'envoi dans le cycle).
   */
  async setResetCode(email: string, code: string, expiration: Date, envois: number) {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }
    await this.utilisateursRepository.update(user.id, {
      digit_code: code,
      date_expiration_code: expiration,
      code_dernier_envoi: new Date(),
      code_envois: envois,
      code_tentatives: 0,
    });
  }

  /**
   * Ferme le cycle de réinitialisation. `code_dernier_envoi` est délibérément
   * conservé : la cadence de renvoi doit survivre à l'invalidation du code,
   * sinon épuiser les tentatives rouvrirait un envoi immédiat.
   */
  async clearResetCode(id: number) {
    await this.utilisateursRepository.update(id, {
      digit_code: null,
      date_expiration_code: null,
      code_envois: 0,
      code_tentatives: 0,
    });
  }

  /** Incrémente en base (et non sur l'entité lue) pour rester juste en concurrence. */
  async incrementResetAttempts(id: number): Promise<number> {
    await this.utilisateursRepository.increment({ id }, 'code_tentatives', 1);
    const { code_tentatives } = await this.utilisateursRepository.findOne({
      where: { id },
      select: ['code_tentatives'],
    });
    return code_tentatives;
  }

  async updatePassword(id: number, hashedPassword: string) {
    await this.utilisateursRepository.update(id, {
      mot_de_passe: hashedPassword,
      digit_code: null,
      date_expiration_code: null,
      code_envois: 0,
      code_tentatives: 0
    });
  }

  /**
   * Mettre à jour le token FCM d'un utilisateur
   * Si le token existe déjà, il est mis à jour
   */
  async updateFcmToken(
    userId: number,
    token: string,
  ): Promise<Utilisateur> {
    const user: Utilisateur = await this.utilisateursRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`Utilisateur ${userId} non trouvé`);
    }

    // const isValid = await this.firebaseService.validateToken(token);
    // if (!isValid) {
    //   this.logger.warn(`Token FCM invalide pour l'utilisateur ${userId}`);
    //   throw new NotFoundException(`FCM Token non valid`)
    // }

    // Vérifier si le token a changé
    if (user.fcm_token !== token) {
      user.fcm_token = token;

      const updatedUser = await this.utilisateursRepository.save(user);

      // Souscrire aux topics Firebase
      await this.subscribeToUserTopics(userId, token);

      this.logger.log(`Token FCM mis à jour pour l'utilisateur ${userId}`);
      return updatedUser;
    }

    return user;
  }

  /**
   * Souscrire un utilisateur aux topics Firebase
   */
  private async subscribeToUserTopics(userId: number, token: string): Promise<void> {
    try {
      const topics = [
        'all_users',
        `user_${userId}`,
        'notifications',
      ];

      for (const topic of topics) {
        try {
          await this.firebaseService.subscribeToTopic(token, topic);
          this.logger.log(`Utilisateur ${userId} abonné au topic: ${topic}`);
        } catch (error) {
          this.logger.warn(`Impossible d'abonner au topic ${topic}:`, error.message);
        }
      }
    } catch (error) {
      this.logger.error(`Erreur lors de l'abonnement aux topics:`, error.message);
    }
  }



  async uploadPhoto(id: string, file: any) {
    this.logger.log(`Mise à jour de la photo de profil pour l'utilisateur ID: ${id}`);
    const user = await this.utilisateursRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    const uploadResult = await this.fichiersService.uploadFile(file, parseInt(id), {
      type: TypeFichier.PROFILE,
      entityId: parseInt(id),
    });

    user.photo = uploadResult.url;
    const updatedUser = await this.utilisateursRepository.save(user);

    delete updatedUser.mot_de_passe;
    return updatedUser;
  }

  async downloadPhoto(id: string) {
    this.logger.log(`Téléchargement de la photo pour l'utilisateur ID: ${id}`);
    const user = await this.utilisateursRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (!user.photo) {
      throw new NotFoundException('Aucune photo de profil disponible');
    }

    return this.fichiersService.downloadFile(user.photo);
  }

  async softDelete(id: number) {
    const user = await this.utilisateursRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    // Calculate deletion date (30 days from now)
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 30);

    user.est_desactive = true;
    user.date_suppression_prevue = deletionDate;

    await this.utilisateursRepository.save(user);
    this.logger.log(`Utilisateur ID ${id} marqué pour suppression le ${deletionDate}`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    await this.context.runForEachCountry(async (country) => {
      this.logger.log(`Cron de suppression des utilisateurs pour ${country}...`);

      const usersToDelete = await this.utilisateursRepository.find({
        where: {
          est_desactive: true,
          date_suppression_prevue: LessThan(new Date()),
        },
      });

      for (const user of usersToDelete) {
        this.logger.log(`Suppression définitive: pays=${country}, ID=${user.id}`);
        await this.utilisateursRepository.remove(user);
      }

      this.logger.log(`${country}: ${usersToDelete.length} utilisateurs supprimés définitivement.`);
    });
  }
}
