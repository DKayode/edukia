import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CountryConfigService } from '../config/country-config.service';
import { ProfilCompletionService } from '../utilisateurs/profil-completion.service';

/**
 * KPI dashboard (Mastercard Foundation reporting). Every figure is scoped by
 * country (pays) and by a [startDate, endDate] period. endDate is inclusive of
 * the whole day — the SQL upper bound is exclusive at endDate + 1 day.
 *
 * Day boundaries are interpreted in the COUNTRY's local timezone, not UTC:
 * date_creation / accessed_at are stored as UTC-naive timestamps, so a Benin
 * (UTC+1) signup at 00:30 local lands on the previous UTC day and would be
 * miscounted by a plain `::date` window. We convert the [start, end] date
 * bounds into their UTC instants for the country zone instead. The zone is
 * resolved from config and validated against pg_timezone_names (fallback UTC),
 * so an unknown name can never error the query.
 *
 * Conventions (confirmed in the spec):
 *  - apprenant / learner = role 'étudiant'; female = sexe 'F'.
 *  - age ≤ 35: age_group in the under-35 buckets ('< 18','18 - 25','26 - 35').
 *    NULL age_group is excluded automatically (not counted). Replaces the former
 *    date_naissance-based computation.
 *  - disability: situation_handicap IS TRUE (booléen).
 *  - logins (KPI 8 / 15): distinct login_events.utilisateur_id in the period.
 *    login_events is append-only, one row per successful login (migration 073).
 *    It replaced refresh_tokens, which could not measure this: createRefreshToken
 *    DELETES the device's previous row before inserting a new one, so only the
 *    LAST login of each user survived. A user returning every week appeared only
 *    in the period of their most recent visit, and re-running a report for a past
 *    period returned a different figure each time. Journal starts 2026-08-11:
 *    earlier periods legitimately read 0.
 *  - KPI 16: distinct learners with a resource_access row (épreuve|concours) in
 *    the trailing week / 2 weeks / month windows, all anchored on endDate.
 */
@Injectable()
export class KpiService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly countryConfig: CountryConfigService,
    private readonly profils: ProfilCompletionService,
  ) {}

  /**
   * Où lire la date de publication et le titre de chaque module. Les tables
   * n'ont pas suivi la même convention au fil du temps — `date_creation` ici,
   * `created_at` là — et cette carte est le seul endroit où cette divergence
   * est écrite.
   */
  private static readonly MODULES: {
    type: string; libelle: string; table: string; dateCol: string; titreCol: string; supprimeCol?: string;
  }[] = [
    { type: 'opportunite', libelle: 'Opportunités',       table: 'opportunites', dateCol: 'date_creation', titreCol: 'titre' },
    { type: 'offre',       libelle: 'Offres (emplois)',   table: 'offres',       dateCol: 'created_at',    titreCol: 'titre' },
    { type: 'service',     libelle: 'Services',           table: 'services',     dateCol: 'created_at',    titreCol: 'titre' },
    { type: 'evenement',   libelle: 'Événements',         table: 'evenements',   dateCol: 'date_creation', titreCol: 'titre' },
    { type: 'parcours',    libelle: 'Parcours inspirants', table: 'parcours',    dateCol: 'created_at',    titreCol: 'titre' },
    // Les forums n'ont pas de `titre` mais un `theme`, et une suppression douce.
    { type: 'forum',       libelle: 'Forums',             table: 'forums',       dateCol: 'created_at',    titreCol: 'theme', supprimeCol: 'deleted_at' },
    { type: 'publicite',   libelle: 'Publicités',         table: 'publicites',   dateCol: 'date_creation', titreCol: 'titre' },
  ];

  async getKpis(pays: string, startDate: string, endDate: string) {
    const n = (v: unknown) => Number(v ?? 0);

    // Resolve a guaranteed-valid zone for this country: config value
    // (alias-normalized), then validated against pg_timezone_names so an
    // unknown name silently degrades to UTC instead of erroring the query.
    const [{ zone }] = await this.dataSource.query(
      `SELECT COALESCE((SELECT name FROM pg_timezone_names WHERE name = $1), 'UTC') AS zone`,
      [this.countryConfig.getTimezone(pays)],
    );

    // UTC instants of the country-local [start 00:00 … (end+1) 00:00) window.
    // lo/hi params: $2 startDate, $3 endDate, $4 zone.
    const lo = `($2::date::timestamp AT TIME ZONE $4) AT TIME ZONE 'UTC'`;
    const hi = `(($3::date + interval '1 day')::timestamp AT TIME ZONE $4) AT TIME ZONE 'UTC'`;

    const [demographics] = await this.dataSource.query(
      `
      SELECT
        COUNT(*)                                                                                  AS total_users,
        COUNT(*) FILTER (WHERE role = 'professeur')                                               AS teachers,
        COUNT(*) FILTER (WHERE role = 'autre')                                                    AS others,
        COUNT(*) FILTER (WHERE age_group = '< 18')                                                AS age_under_18,
        COUNT(*) FILTER (WHERE age_group = '18 - 25')                                             AS age_18_25,
        COUNT(*) FILTER (WHERE age_group = '26 - 35')                                             AS age_26_35,
        COUNT(*) FILTER (WHERE age_group IN ('36 - 50', '> 50'))                                  AS age_over_35,
        COUNT(*) FILTER (WHERE age_group IN ('< 18','18 - 25','26 - 35'))                         AS users_age_35,
        COUNT(*) FILTER (WHERE sexe = 'F')                                                         AS female_users,
        COUNT(*) FILTER (WHERE sexe = 'F' AND age_group IN ('< 18','18 - 25','26 - 35'))         AS female_age_35,
        COUNT(*) FILTER (WHERE zone_residence = 'rural')                                           AS rural_users,
        COUNT(*) FILTER (WHERE situation_handicap IS TRUE)                                         AS disability_users,
        COUNT(*) FILTER (WHERE role = 'étudiant')                                                  AS learners,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND age_group = '< 18')                          AS learners_age_under_18,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND age_group = '18 - 25')                       AS learners_age_18_25,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND age_group = '26 - 35')                       AS learners_age_26_35,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND age_group IN ('36 - 50', '> 50'))            AS learners_age_over_35,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND age_group IN ('< 18','18 - 25','26 - 35'))  AS learners_age_35,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND sexe = 'F' AND age_group IN ('< 18','18 - 25','26 - 35')) AS learners_age_35_female,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND sexe = 'F')                                   AS female_learners,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND zone_residence = 'rural')                     AS rural_learners,
        COUNT(*) FILTER (WHERE role = 'étudiant' AND situation_handicap IS TRUE)                  AS disability_learners
      FROM utilisateurs
      WHERE pays = $1
        AND date_creation >= ${lo}
        AND date_creation < ${hi}
      `,
      [pays, startDate, endDate, zone],
    );

    const [logins] = await this.dataSource.query(
      `
      SELECT
        COUNT(DISTINCT rt.utilisateur_id)                                       AS users_logged_in,
        COUNT(DISTINCT rt.utilisateur_id) FILTER (WHERE u.role = 'étudiant')    AS learners_logged_in
      FROM login_events rt
      JOIN utilisateurs u ON u.id = rt.utilisateur_id
      WHERE u.pays = $1
        AND rt.date_creation >= ${lo}
        AND rt.date_creation < ${hi}
      `,
      [pays, startDate, endDate, zone],
    );

    // KPI 16 windows are anchored on the country-local end-of-endDate instant.
    const endUtc = `(($2::date + interval '1 day')::timestamp AT TIME ZONE $3) AT TIME ZONE 'UTC'`;
    const [access] = await this.dataSource.query(
      `
      SELECT
        COUNT(DISTINCT ra.utilisateur_id) FILTER (WHERE ra.accessed_at >= (${endUtc} - interval '7 days'))  AS last_week,
        COUNT(DISTINCT ra.utilisateur_id) FILTER (WHERE ra.accessed_at >= (${endUtc} - interval '14 days')) AS last_two_weeks,
        COUNT(DISTINCT ra.utilisateur_id) FILTER (WHERE ra.accessed_at >= (${endUtc} - interval '1 month')) AS last_month
      FROM resource_access ra
      JOIN utilisateurs u ON u.id = ra.utilisateur_id AND u.role = 'étudiant'
      WHERE ra.pays = $1
        AND ra.resource_type IN ('epreuve', 'concours')
        AND ra.accessed_at < ${endUtc}
      `,
      [pays, endDate, zone],
    );

    const [activeLearners] = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT u.id)::int AS active_learners
      FROM utilisateurs u
      WHERE u.pays = $1
        AND u.role = 'étudiant'
        AND (
          EXISTS (
            SELECT 1
            FROM login_events le
            WHERE le.utilisateur_id = u.id
              AND le.date_creation >= (${endUtc} - interval '30 days')
              AND le.date_creation < ${endUtc}
          )
          OR EXISTS (
            SELECT 1
            FROM resource_access ra
            WHERE ra.utilisateur_id = u.id
              AND ra.accessed_at >= (${endUtc} - interval '30 days')
              AND ra.accessed_at < ${endUtc}
          )
        )
      `,
      [pays, endDate, zone],
    );

    const [audience, contenu, communaute, jobkia, croissance, journaux] = await Promise.all([
      this.audienceModules(pays, lo, hi, startDate, endDate, zone),
      this.offreContenu(pays, lo, hi, startDate, endDate, zone),
      this.communaute(pays, lo, hi, startDate, endDate, zone),
      this.jobkia(pays, lo, hi, startDate, endDate, zone),
      this.croissance(pays, lo, hi, startDate, endDate, zone),
      this.journaux(),
    ]);

    return {
      pays,
      periode: { startDate, endDate },
      // Section 2 — Utilisateurs (over the period, by date_creation)
      utilisateurs: {
        total: n(demographics.total_users),               // KPI 2
        professeurs: n(demographics.teachers),
        autres: n(demographics.others),
        age_35_max: n(demographics.users_age_35),          // KPI 3
        age_ranges: {
          moins_18: n(demographics.age_under_18),
          de_18_25: n(demographics.age_18_25),
          de_26_35: n(demographics.age_26_35),
          plus_35: n(demographics.age_over_35),
        },
        femmes: n(demographics.female_users),              // KPI 4
        femmes_35_max: n(demographics.female_age_35),      // KPI 5
        zone_rurale: n(demographics.rural_users),          // KPI 6
        situation_handicap: n(demographics.disability_users), // KPI 7
        connectes: n(logins.users_logged_in),              // KPI 8
      },
      // Section 3 — Apprenants / Inscription (role 'étudiant')
      apprenants: {
        total: n(demographics.learners),                   // KPI 9
        age_35_max: n(demographics.learners_age_35),       // KPI 10
        age_ranges: {
          moins_18: n(demographics.learners_age_under_18),
          de_18_25: n(demographics.learners_age_18_25),
          de_26_35: n(demographics.learners_age_26_35),
          plus_35: n(demographics.learners_age_over_35),
        },
        age_35_max_femmes: n(demographics.learners_age_35_female), // KPI 11
        femmes: n(demographics.female_learners),           // KPI 12
        zone_rurale: n(demographics.rural_learners),       // KPI 13
        situation_handicap: n(demographics.disability_learners),  // KPI 14
      },
      // Section 4 — Engagement
      engagement: {
        apprenants_actifs: n(activeLearners?.active_learners),
        apprenants_connectes: n(logins.learners_logged_in), // KPI 15
        apprenants_ressource: {                             // KPI 16
          semaine: n(access.last_week),
          deux_semaines: n(access.last_two_weeks),
          mois: n(access.last_month),
        },
      },
      // ── #260 ─────────────────────────────────────────────────────────────
      audience,
      contenu,
      communaute,
      jobkia,
      croissance,
      journaux,
    };
  }

  /**
   * Ce que les utilisateurs sont allés voir, module par module.
   *
   * C'est la réponse à #260, et elle ne vaut que par le journal qui l'alimente :
   * avant l'instrumentation, ces chiffres sont vides — pas nuls au sens d'un
   * désintérêt, simplement inexistants. `journaux.audience_modules_depuis` dit
   * à partir de quand ils veulent dire quelque chose.
   */
  private async audienceModules(
    pays: string, lo: string, hi: string, startDate: string, endDate: string, zone: string,
  ) {
    const totaux = await this.dataSource.query(
      `SELECT resource_type,
              COUNT(*)::int                        AS vues,
              COUNT(DISTINCT utilisateur_id)::int  AS utilisateurs
         FROM resource_access
        WHERE pays = $1
          AND accessed_at >= ${lo}
          AND accessed_at <  ${hi}
        GROUP BY resource_type`,
      [pays, startDate, endDate, zone],
    );
    const parType = new Map(totaux.map((r: any) => [r.resource_type, r]));

    // Les fiches les plus consultées, module par module. Une requête par module
    // plutôt qu'une jointure polymorphe : les titres vivent dans sept tables
    // différentes, et un CASE géant serait illisible pour rien — la page est
    // administrative, ces requêtes sont indexées et rares.
    const modules = await Promise.all(
      KpiService.MODULES.map(async (m) => {
        const t: any = parType.get(m.type) ?? { vues: 0, utilisateurs: 0 };
        const top = t.vues
          ? await this.dataSource.query(
              `SELECT ra.resource_id::int AS id,
                      COALESCE(x.${m.titreCol}, '(supprimé)') AS titre,
                      COUNT(*)::int AS vues,
                      COUNT(DISTINCT ra.utilisateur_id)::int AS utilisateurs
                 FROM resource_access ra
                 LEFT JOIN ${m.table} x ON x.id = ra.resource_id
                WHERE ra.pays = $1
                  AND ra.resource_type = $5
                  AND ra.accessed_at >= ${lo}
                  AND ra.accessed_at <  ${hi}
                GROUP BY ra.resource_id, x.${m.titreCol}
                ORDER BY vues DESC
                LIMIT 5`,
              [pays, startDate, endDate, zone, m.type],
            )
          : [];
        return {
          type: m.type,
          libelle: m.libelle,
          vues: Number(t.vues ?? 0),
          utilisateurs: Number(t.utilisateurs ?? 0),
          top,
        };
      }),
    );

    const opportunitesParType = await this.dataSource.query(
      `SELECT o.type,
              COUNT(*)::int                          AS vues,
              COUNT(DISTINCT ra.utilisateur_id)::int AS utilisateurs
         FROM resource_access ra
         JOIN opportunites o ON o.id = ra.resource_id
        WHERE ra.pays = $1
          AND ra.resource_type = 'opportunite'
          AND ra.accessed_at >= ${lo}
          AND ra.accessed_at <  ${hi}
        GROUP BY o.type`,
      [pays, startDate, endDate, zone],
    );

    const boursesRow = opportunitesParType.find(
      (r: any) => String(r.type).toLowerCase() === 'bourses',
    );
    const stagesRow = opportunitesParType.find(
      (r: any) => String(r.type).toLowerCase() === 'stages',
    );

    const opportunites = {
      bourses: {
        vues: Number(boursesRow?.vues ?? 0),
        utilisateurs: Number(boursesRow?.utilisateurs ?? 0),
      },
      stages: {
        vues: Number(stagesRow?.vues ?? 0),
        utilisateurs: Number(stagesRow?.utilisateurs ?? 0),
      },
    };

    return {
      modules,
      opportunites,
      total_vues: modules.reduce((n, m) => n + m.vues, 0),
      // Somme volontairement absente : additionner des « utilisateurs distincts »
      // par module compterait plusieurs fois qui a visité deux modules.
      utilisateurs_distincts: Number(
        (
          await this.dataSource.query(
            `SELECT COUNT(DISTINCT utilisateur_id)::int AS n
               FROM resource_access
              WHERE pays = $1
                AND resource_type = ANY($5)
                AND accessed_at >= ${lo}
                AND accessed_at <  ${hi}`,
            [pays, startDate, endDate, zone, KpiService.MODULES.map((m) => m.type)],
          )
        )[0].n ?? 0,
      ),
    };
  }

  /** Ce qui a été publié sur la période — le dénominateur de l'audience. */
  private async offreContenu(
    pays: string, lo: string, hi: string, startDate: string, endDate: string, zone: string,
  ) {
    const parts = KpiService.MODULES.map(
      (m) => `SELECT '${m.type}' AS type,
                     COUNT(*) FILTER (WHERE ${m.dateCol} >= ${lo} AND ${m.dateCol} < ${hi})::int AS publies,
                     COUNT(*)::int AS total
                FROM ${m.table}
               WHERE pays = $1${m.supprimeCol ? ` AND ${m.supprimeCol} IS NULL` : ''}`,
    ).join(' UNION ALL ');
    const lignes = await this.dataSource.query(parts, [pays, startDate, endDate, zone]);
    const parType = new Map(lignes.map((r: any) => [r.type, r]));
    return KpiService.MODULES.map((m) => {
      const r: any = parType.get(m.type) ?? {};
      return { type: m.type, libelle: m.libelle, publies: Number(r.publies ?? 0), total: Number(r.total ?? 0) };
    });
  }

  /** Forums, commentaires, likes : la seule activité communautaire mesurée. */
  private async communaute(
    pays: string, lo: string, hi: string, startDate: string, endDate: string, zone: string,
  ) {
    const [r] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM forums
           WHERE pays = $1 AND deleted_at IS NULL
             AND created_at >= ${lo} AND created_at < ${hi})                          AS forums_ouverts,
         (SELECT COUNT(*)::int FROM commentaires
           WHERE pays = $1 AND date_commentaire >= ${lo} AND date_commentaire < ${hi}) AS commentaires,
         (SELECT COUNT(DISTINCT utilisateur_id)::int FROM commentaires
           WHERE pays = $1 AND date_commentaire >= ${lo} AND date_commentaire < ${hi}) AS commentateurs,
         (SELECT COUNT(*)::int FROM like_users
           WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi})            AS likes,
         (SELECT COUNT(DISTINCT user_id)::int FROM like_users
           WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi})            AS likeurs`,
      [pays, startDate, endDate, zone],
    );
    return {
      forums_ouverts: Number(r.forums_ouverts),
      commentaires: Number(r.commentaires),
      commentateurs: Number(r.commentateurs),
      likes: Number(r.likes),
      likeurs: Number(r.likeurs),
    };
  }

  /** Le côté offre de la place de marché JobKia. */
  private async jobkia(
    pays: string, lo: string, hi: string, startDate: string, endDate: string, zone: string,
  ) {
    const [r] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM prestataires WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi}) AS prestataires_inscrits,
         (SELECT COUNT(*)::int FROM prestataires WHERE pays = $1)                                                AS prestataires_total,
         (SELECT COUNT(*)::int FROM recruteurs   WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi}) AS recruteurs_inscrits,
         (SELECT COUNT(*)::int FROM recruteurs   WHERE pays = $1)                                                AS recruteurs_total,
         (SELECT COUNT(*)::int FROM services     WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi}) AS services_publies,
         (SELECT COUNT(*)::int FROM offres       WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi}) AS offres_publiees,
         (SELECT COUNT(*)::int FROM avis         WHERE pays = $1 AND created_at >= ${lo} AND created_at < ${hi}) AS avis_deposes`,
      [pays, startDate, endDate, zone],
    );
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v ?? 0)]));
  }

  /**
   * Les indicateurs qu'un investisseur regarde : activation, rétention,
   * assiduité, monétisation.
   *
   * Deux réserves, portées dans la réponse plutôt que tues :
   *  - activation et rétention se lisent dans `login_events`, qui ne commence
   *    qu'au 11/08/2026 ; une cohorte inscrite avant paraît non activée alors
   *    que ses connexions n'ont simplement jamais été journalisées. On ne
   *    retient donc que les cohortes postérieures au début du journal.
   *  - les abonnements sont livrés désactivés : 0 n'est pas un échec commercial.
   */
  private async croissance(
    pays: string, lo: string, hi: string, startDate: string, endDate: string, zone: string,
  ) {
    const debutJournal = `'2026-08-11'::timestamptz`;

    const [activation] = await this.dataSource.query(
      `WITH cohorte AS (
         SELECT id, date_creation FROM utilisateurs
          WHERE pays = $1 AND date_creation >= ${lo} AND date_creation < ${hi}
            AND date_creation >= ${debutJournal}
       )
       SELECT
         COUNT(*)::int AS cohorte,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM login_events e WHERE e.utilisateur_id = c.id))::int AS actives,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM login_events e WHERE e.utilisateur_id = c.id
             AND e.date_creation >  c.date_creation + interval '1 day'
             AND e.date_creation <= c.date_creation + interval '7 days'))::int AS revenus_j7,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM login_events e WHERE e.utilisateur_id = c.id
             AND e.date_creation >  c.date_creation + interval '1 day'
             AND e.date_creation <= c.date_creation + interval '30 days'))::int AS revenus_j30
       FROM cohorte c`,
      [pays, startDate, endDate, zone],
    );

    const finUtc = `(($2::date + interval '1 day')::timestamp AT TIME ZONE $3) AT TIME ZONE 'UTC'`;
    const [assiduite] = await this.dataSource.query(
      `SELECT
         COUNT(DISTINCT e.utilisateur_id) FILTER (WHERE e.date_creation >= ${finUtc} - interval '7 days')::int  AS wau,
         COUNT(DISTINCT e.utilisateur_id) FILTER (WHERE e.date_creation >= ${finUtc} - interval '30 days')::int AS mau
       FROM login_events e
       JOIN utilisateurs u ON u.id = e.utilisateur_id
      WHERE u.pays = $1 AND e.date_creation < ${finUtc}`,
      [pays, endDate, zone],
    );

    const [monetisation] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM abonnements
           WHERE pays = $1 AND statut = 'actif' AND date_fin > now())                       AS abonnements_actifs,
         (SELECT COUNT(*)::int FROM abonnements
           WHERE pays = $1 AND date_creation >= ${lo} AND date_creation < ${hi})            AS abonnements_souscrits,
         (SELECT COUNT(*)::int FROM wallets w JOIN utilisateurs u ON u.id = w.user_id
           WHERE u.pays = $1)                                                               AS portefeuilles,
         (SELECT COUNT(*)::int FROM wallet_transactions t
             JOIN wallets w ON w.id = t.wallet_id
             JOIN utilisateurs u ON u.id = w.user_id
           WHERE u.pays = $1 AND t.created_at >= ${lo} AND t.created_at < ${hi})            AS transactions`,
      [pays, startDate, endDate, zone],
    );

    // Complétion moyenne du profil : on réutilise la répartition de #259
    // plutôt que de réécrire l'expression des seize champs, qui divergerait
    // dès qu'un champ serait ajouté d'un côté seulement.
    const distribution = await this.profils.distribution(pays);
    const completionMoyenne = distribution.total
      ? Math.round(
          distribution.repartition.reduce((n, l) => n + l.pourcentage * l.comptes, 0) /
            distribution.total,
        )
      : 0;

    const part = (num: number, den: number) => (den ? Math.round((num * 1000) / den) / 10 : 0);

    return {
      activation: {
        cohorte: Number(activation.cohorte),
        actives: Number(activation.actives),
        taux: part(Number(activation.actives), Number(activation.cohorte)),
      },
      retention: {
        j7: part(Number(activation.revenus_j7), Number(activation.cohorte)),
        j30: part(Number(activation.revenus_j30), Number(activation.cohorte)),
      },
      assiduite: {
        wau: Number(assiduite.wau),
        mau: Number(assiduite.mau),
        collage: part(Number(assiduite.wau), Number(assiduite.mau)),
      },
      profil: { completion_moyenne: completionMoyenne, comptes: distribution.total },
      monetisation: {
        abonnements_actifs: Number(monetisation.abonnements_actifs),
        abonnements_souscrits: Number(monetisation.abonnements_souscrits),
        portefeuilles: Number(monetisation.portefeuilles),
        transactions: Number(monetisation.transactions),
      },
    };
  }

  /**
   * Depuis quand chaque journal existe. Sans ces dates, une période antérieure
   * affiche des colonnes vides qui se lisent comme un effondrement de l'usage
   * alors qu'il s'agit d'une absence d'historique.
   */
  private async journaux() {
    const [r] = await this.dataSource.query(
      `SELECT
         (SELECT MIN(accessed_at)::date FROM resource_access)                                        AS ressources_depuis,
         (SELECT MIN(date_creation)::date FROM login_events)                                         AS connexions_depuis,
         (SELECT MIN(accessed_at)::date FROM resource_access
           WHERE resource_type NOT IN ('epreuve','concours','examen_national'))                      AS audience_modules_depuis`,
    );
    return {
      ressources_depuis: r.ressources_depuis,
      connexions_depuis: r.connexions_depuis,
      // NULL tant qu'aucune fiche de module n'a été consultée : le front doit
      // alors dire « pas encore de données », pas afficher un zéro sec.
      audience_modules_depuis: r.audience_modules_depuis,
    };
  }
}
