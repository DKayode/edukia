import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CampagneCode } from './entities/campagne-code.entity';
import { CodeUtilisation } from './entities/code-utilisation.entity';
import { Code, OrigineCode } from './entities/code.entity';
import { CodeEffet, Effet } from './entities/code-effet.entity';
import { CodeValidationService } from './code-validation.service';
import { CreateCodeDto } from './dto/create-code.dto';
import { UpdateCodeDto } from './dto/update-code.dto';
import { GenererCampagneDto } from './dto/generer-campagne.dto';
import { FilterCodesDto } from './dto/filter-codes.dto';

/**
 * Alphabet sans caractères ambigus.
 *
 * Ces codes se dictent à l'oral et se tapent sur mobile : `0`/`O` et `1`/`I`/`L`
 * produisent des saisies fausses que l'utilisateur ne peut pas diagnostiquer.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

@Injectable()
export class CodesService {
  private readonly logger = new Logger(CodesService.name);

  constructor(
    @InjectRepository(Code) private readonly codes: Repository<Code>,
    @InjectRepository(CampagneCode) private readonly campagnes: Repository<CampagneCode>,
    @InjectRepository(CodeUtilisation) private readonly utilisations: Repository<CodeUtilisation>,
    @InjectRepository(CodeEffet) private readonly effetsRepo: Repository<CodeEffet>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async findAll(pays: string, filtre: FilterCodesDto) {
    const page = filtre.page ?? 1;
    const limit = filtre.limit ?? 20;

    const qb = this.codes
      .createQueryBuilder('code')
      .leftJoinAndSelect('code.effets', 'effets')
      .leftJoin('code.proprietaire', 'proprietaire')
      .addSelect(['proprietaire.id', 'proprietaire.nom', 'proprietaire.prenom', 'proprietaire.email'])
      .leftJoinAndSelect('code.campagne', 'campagne')
      .where('code.pays = :pays', { pays });

    // Les codes d'inscription sont générés automatiquement : les mêler au
    // catalogue noierait ce dernier sous des dizaines de milliers de lignes.
    if (filtre.origine) qb.andWhere('code.origine = :origine', { origine: filtre.origine });
    else qb.andWhere('code.origine = :admin', { admin: OrigineCode.ADMIN });

    // « Montre-moi tous les codes qui offrent un abonnement » — une question
    // impossible à poser avec l'ancienne énumération de types.
    if (filtre.effet) {
      qb.andWhere('EXISTS (SELECT 1 FROM code_effets e WHERE e.code_id = code.id AND e.effet = :effet)', {
        effet: filtre.effet,
      });
    }

    if (filtre.campagne_uuid) qb.andWhere('campagne.uuid = :cu', { cu: filtre.campagne_uuid });
    if (filtre.est_actif !== undefined) qb.andWhere('code.est_actif = :a', { a: filtre.est_actif });
    if (filtre.search) qb.andWhere('(upper(code.code) LIKE :q OR code.libelle ILIKE :q2)', {
      q: `%${filtre.search.toUpperCase()}%`,
      q2: `%${filtre.search}%`,
    });

    const [data, total] = await qb
      .orderBy('code.date_creation', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByUuid(uuid: string): Promise<Code> {
    const code = await this.codes.findOne({ where: { uuid }, relations: ['campagne', 'proprietaire'] });
    if (!code) throw new NotFoundException('Code introuvable');
    return code;
  }

  async create(pays: string, dto: CreateCodeDto, adminId?: number): Promise<Code> {
    const code = CodeValidationService.normaliser(dto.code);
    if (await this.existe(code)) throw new ConflictException(`Le code ${code} existe déjà`);

    const effets = dto.effets ?? [];
    CodeValidationService.verifierCoherence(effets.map((e) => e.effet));
    if (effets.some((e) => e.effet === Effet.COMMISSION) && !dto.proprietaire_id) {
      throw new BadRequestException('Un effet COMMISSION exige un propriétaire à créditer');
    }

    const { effets: _e, ...champs } = dto;
    const sauvegarde = await this.codes.save(
      this.codes.create({
        ...champs,
        code,
        pays,
        origine: OrigineCode.ADMIN,
        cree_par: adminId ?? null,
        plans_eligibles: dto.plans_eligibles?.length ? dto.plans_eligibles : null,
        effets: effets.map((e) => ({ effet: e.effet, parametres: e.parametres ?? null }) as CodeEffet),
      }),
    );
    this.logger.log(`Code ${sauvegarde.code} créé (${effets.map((e) => e.effet).join('+') || 'sans effet'}, ${pays})`);
    return this.findByUuid(sauvegarde.uuid);
  }

  async update(uuid: string, dto: UpdateCodeDto): Promise<Code> {
    const code = await this.findByUuid(uuid);
    if (dto.code && CodeValidationService.normaliser(dto.code) !== code.code.toUpperCase()) {
      const nouveau = CodeValidationService.normaliser(dto.code);
      if (await this.existe(nouveau)) throw new ConflictException(`Le code ${nouveau} existe déjà`);
      code.code = nouveau;
    }
    const { code: _ignore, effets, ...reste } = dto;
    Object.assign(code, reste);

    // Remplacement complet plutôt que fusion : une modification partielle des
    // effets laisserait des combinaisons que l'écran n'a pas voulues.
    if (effets) {
      CodeValidationService.verifierCoherence(effets.map((e) => e.effet));
      await this.effetsRepo.delete({ code_id: code.id });
      code.effets = effets.map((e) => ({ effet: e.effet, parametres: e.parametres ?? null }) as CodeEffet);
    }
    if (dto.plans_eligibles !== undefined) {
      code.plans_eligibles = dto.plans_eligibles?.length ? dto.plans_eligibles : null;
    }
    return this.codes.save(code);
  }

  /** Désactivation logique : un code utilisé garde son historique. */
  async desactiver(uuid: string): Promise<Code> {
    const code = await this.findByUuid(uuid);
    code.est_actif = false;
    return this.codes.save(code);
  }

  async utilisationsDuCode(uuid: string) {
    const code = await this.findByUuid(uuid);
    return this.dataSource.query(
      `SELECT cu.id, cu.montant_remise, cu.date_creation,
              u.uuid AS utilisateur_uuid, u.nom, u.prenom, u.email,
              a.uuid AS abonnement_uuid, a.statut
         FROM codes_utilisations cu
         JOIN utilisateurs u ON u.id = cu.utilisateur_id
    LEFT JOIN abonnements a  ON a.id = cu.abonnement_id
        WHERE cu.code_id = $1
     ORDER BY cu.date_creation DESC
        LIMIT 200`,
      [code.id],
    );
  }

  // ── Campagnes ────────────────────────────────────────────────────────────

  async campagnesList(pays: string) {
    const campagnes = await this.campagnes.find({ where: { pays }, order: { date_creation: 'DESC' } });
    if (!campagnes.length) return [];

    // Une requête d'agrégat pour toutes les campagnes, pas une par ligne.
    const stats = await this.dataSource.query(
      `SELECT c.campagne_id,
              COUNT(*)::int                                   AS total,
              COUNT(*) FILTER (WHERE u.n > 0)::int            AS utilises
         FROM codes c
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM codes_utilisations cu WHERE cu.code_id = c.id) u ON true
        WHERE c.campagne_id = ANY($1)
     GROUP BY c.campagne_id`,
      [campagnes.map((c) => c.id)],
    );
    const parId = new Map<number, any>(stats.map((s: any) => [Number(s.campagne_id), s]));

    return campagnes.map((c) => ({
      ...c,
      codes_generes: Number(parId.get(c.id)?.total ?? 0),
      codes_utilises: Number(parId.get(c.id)?.utilises ?? 0),
    }));
  }

  /**
   * Génère n codes uniques à usage unique — le second cas de l'issue.
   *
   * Les codes sont insérés en UN seul INSERT, pas n requêtes : une campagne de
   * 5 000 codes ne doit pas ouvrir 5 000 allers-retours. Les collisions sont
   * absorbées par `ON CONFLICT DO NOTHING`, et on complète jusqu'au compte.
   */
  /**
   * Génère n codes uniques à usage unique — le second cas de l'issue.
   *
   * Les codes sont insérés par lots, pas un par un : une campagne de 5 000 codes
   * ne doit pas ouvrir 5 000 allers-retours. Les collisions sont absorbées par
   * `ON CONFLICT DO NOTHING`, et on complète jusqu'au compte demandé.
   */

  /**
   * Les codes que possède un utilisateur, avec leur état d'usage.
   *
   * Répond à la question de l'acheteur : « lesquels ont été utilisés, et par
   * qui ? ». L'état se lit sur le JOURNAL des utilisations, pas sur le compteur
   * `usage_actuel` — celui-ci est un cache, et un écart ferait mentir la liste.
   */
  async mesCodes(utilisateurId: number, pays: string) {
    const codes = await this.codes.find({
      where: { proprietaire_id: utilisateurId, pays },
      order: { date_creation: 'DESC' },
    });
    if (!codes.length) return [];

    const utilisations = await this.dataSource.query(
      `SELECT u.code_id, u.date_creation, u.utilisateur_id,
              x.prenom, x.nom, x.email
         FROM codes_utilisations u
         LEFT JOIN utilisateurs x ON x.id = u.utilisateur_id
        WHERE u.code_id = ANY($1)
        ORDER BY u.date_creation`,
      [codes.map((c) => c.id)],
    );
    const parCode = new Map<number, any[]>();
    for (const u of utilisations) {
      if (!parCode.has(u.code_id)) parCode.set(u.code_id, []);
      parCode.get(u.code_id)!.push(u);
    }

    return codes.map((c) => {
      const usages = parCode.get(c.id) ?? [];
      const premier = usages[0];
      return {
        code: c.code,
        origine: c.origine,
        libelle: c.libelle,
        est_actif: c.est_actif,
        utilise: usages.length > 0,
        // Qui l'a utilisé, et quand. Le nom est celui du bénéficiaire, pas de
        // l'acheteur — c'est l'information qu'il cherche.
        utilise_le: premier?.date_creation ?? null,
        utilise_par: premier
          ? {
              nom: [premier.prenom, premier.nom].filter(Boolean).join(' ') || null,
              email: premier.email ?? null,
            }
          : null,
        // Un code d'achat ne sert qu'une fois ; un code de parrainage, sans
        // limite. Le client n'a pas à connaître la règle pour l'afficher.
        usages_restants:
          c.usage_max_total == null ? null : Math.max(0, c.usage_max_total - usages.length),
        date_creation: c.date_creation,
      };
    });
  }

  async genererCampagne(pays: string, dto: GenererCampagneDto, adminId?: number) {
    const effets = dto.effets ?? [];
    CodeValidationService.verifierCoherence(effets.map((e) => e.effet));
    // Une campagne distribue des codes anonymes : personne à créditer.
    if (effets.some((e) => e.effet === Effet.COMMISSION)) {
      throw new BadRequestException(
        'Une campagne génère des codes sans propriétaire : l’effet COMMISSION n’a personne à créditer.',
      );
    }

    const prefixe = dto.prefixe ? CodeValidationService.normaliser(dto.prefixe) : '';
    const campagne = await this.campagnes.save(
      this.campagnes.create({
        pays,
        nom: dto.nom,
        description: dto.description ?? null,
        prefixe: prefixe || null,
        nombre_codes: dto.nombre_codes,
        effets: effets.length ? effets : null,
        date_debut: dto.date_debut ? new Date(dto.date_debut) : null,
        date_fin: dto.date_fin ? new Date(dto.date_fin) : null,
        cree_par: adminId ?? null,
      }),
    );

    let inseres = 0;
    for (let tentative = 0; tentative < 10 && inseres < dto.nombre_codes; tentative++) {
      const manquants = dto.nombre_codes - inseres;
      const candidats = Array.from({ length: manquants }, () => this.genererCode(prefixe));

      const params: any[] = [];
      const lignes = candidats.map((c) => {
        params.push(pays, c, campagne.id, dto.date_debut ?? null, dto.date_fin ?? null, adminId ?? null);
        const i = params.length - 6;
        return `($${i + 1}, $${i + 2}, 'ADMIN', $${i + 3}, 1, 1, $${i + 4}, $${i + 5}, $${i + 6})`;
      });

      const crees = await this.dataSource.query(
        `INSERT INTO codes (pays, code, origine, campagne_id, usage_max_total, usage_max_par_utilisateur,
                            date_debut, date_fin, cree_par)
         VALUES ${lignes.join(',')}
         ON CONFLICT DO NOTHING
         RETURNING id`,
        params,
      );

      // Les effets du gabarit, posés sur chaque code réellement créé.
      if (crees.length && effets.length) {
        const pEffets: any[] = [];
        const vEffets = crees.flatMap((c: any) =>
          effets.map((e) => {
            pEffets.push(c.id, e.effet, e.parametres ? JSON.stringify(e.parametres) : null);
            const i = pEffets.length - 3;
            return `($${i + 1}, $${i + 2}, $${i + 3}::jsonb)`;
          }),
        );
        await this.dataSource.query(
          `INSERT INTO code_effets (code_id, effet, parametres) VALUES ${vEffets.join(',')} ON CONFLICT DO NOTHING`,
          pEffets,
        );
      }
      inseres += crees.length;
    }

    if (inseres < dto.nombre_codes) {
      this.logger.warn(
        `Campagne ${campagne.nom} : ${inseres}/${dto.nombre_codes} codes générés (collisions répétées)`,
      );
    }
    this.logger.log(`Campagne ${campagne.nom} : ${inseres} code(s) généré(s)`);
    return { campagne, codes_generes: inseres, demandes: dto.nombre_codes };
  }

  /** Export CSV d'une campagne — les codes doivent sortir pour être distribués. */
  async exporterCampagne(uuid: string): Promise<string> {
    const campagne = await this.campagnes.findOne({ where: { uuid } });
    if (!campagne) throw new NotFoundException('Campagne introuvable');

    const lignes = await this.dataSource.query(
      `SELECT c.code,
              (SELECT COUNT(*)::int FROM codes_utilisations cu WHERE cu.code_id = c.id) AS utilise
         FROM codes c WHERE c.campagne_id = $1 ORDER BY c.id`,
      [campagne.id],
    );
    const entete = 'code;utilise';
    return [entete, ...lignes.map((l: any) => `${l.code};${Number(l.utilise) > 0 ? 'oui' : 'non'}`)].join('\n');
  }

  private genererCode(prefixe: string): string {
    const corps = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    return prefixe ? `${prefixe}-${corps}` : corps;
  }

  private async existe(code: string): Promise<boolean> {
    const [r] = await this.codes.query(`SELECT 1 FROM codes WHERE upper(code) = $1 LIMIT 1`, [code]);
    return !!r;
  }

  /**
   * Enregistre le code de parrainage d'un nouveau compte dans le registre.
   *
   * Best-effort : l'inscription ne doit pas échouer parce que le registre est
   * indisponible. La résolution à l'achat retombe alors sur
   * `utilisateurs.mon_code_parrainage`.
   */
  async enregistrerCodeParrainage(utilisateurId: number, code: string, pays = 'benin'): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const [ligne] = await manager.query(
          `INSERT INTO codes (pays, code, origine, proprietaire_id, usage_max_total, usage_max_par_utilisateur, est_actif)
           VALUES ($1, $2, 'INSCRIPTION', $3, NULL, 1, true)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [pays, CodeValidationService.normaliser(code), utilisateurId],
        );
        if (ligne?.id) {
          await manager.query(
            `INSERT INTO code_effets (code_id, effet, parametres)
             VALUES ($1, 'COMMISSION', NULL)
             ON CONFLICT DO NOTHING`,
            [ligne.id],
          );
        }
      });
    } catch (err) {
      this.logger.warn(`Enregistrement du code de parrainage ${code} échoué : ${err?.message ?? err}`);
    }
  }
}
