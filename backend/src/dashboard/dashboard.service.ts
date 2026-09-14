import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QuotaService } from '../abonnements/quota.service';

const JOURS_PAR_DEFAUT = 28;

/**
 * L'activité d'UN étudiant sur Edukia — la part du tableau de bord « Pour toi »
 * que Kessiah ne peut pas voir depuis chez elle.
 *
 * Kessiah connaît ses propres conversations, exercices et documents, mais pas
 * les téléchargements d'épreuves ni les connexions : ces deux tables vivent
 * ici. C'est elle qui appelle cet endpoint, en relayant le jeton de l'étudiant,
 * puis assemble le tout (voir app/services/dashboard.py côté Kessiah).
 *
 * `resource_access` et `login_events` n'ont pas d'entité TypeORM exploitable
 * pour de l'agrégation : on les lit en SQL brut via le DataSource injecté,
 * comme le fait SubmissionsStatsService.
 * Les quotas personnels, eux, viennent de QuotaService : ce sont les mêmes
 * chiffres que `/abonnements/mes-quotas`, adossés à `quota_consommations`.
 * Le pays du compte ne sert ici qu'à choisir la configuration de quota
 * applicable ; les compteurs d'activité sont filtrés par `utilisateur_id`.
 *
 * À la différence de KpiService, qui compte des utilisateurs distincts pour un
 * rapport pays, tout ici est filtré sur un seul `utilisateur_id`.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly quotas: QuotaService,
  ) {}

  async getActivite(utilisateurId: number, jours?: number) {
    const profondeur = jours ?? JOURS_PAR_DEFAUT;
    const pays = await this.paysUtilisateur(utilisateurId);

    const [serie, streak, compteurs, etatQuotas] = await Promise.all([
      this.serieJournaliere(utilisateurId, profondeur),
      this.streak(utilisateurId),
      this.compteurs(utilisateurId),
      this.quotas.etatPourUtilisateur(utilisateurId, pays),
    ]);
    const quotas = this.enrichirQuotas(etatQuotas);

    return {
      jours: serie,
      streak_jours: streak.streak_jours,
      derniere_connexion: streak.derniere_connexion,
      epreuves_consultees: compteurs.epreuves_consultees,
      examens_nationaux_consultes: compteurs.examens_nationaux_consultes,
      concours_consultes: compteurs.concours_consultes,
      ressources_academiques_consultees: compteurs.ressources_academiques_consultees,
      soumissions: compteurs.soumissions,
      kpis: {
        epreuves_consultees: compteurs.epreuves_consultees,
        examens_nationaux_consultes: compteurs.examens_nationaux_consultes,
        concours_consultes: compteurs.concours_consultes,
        ressources_academiques_consultees: compteurs.ressources_academiques_consultees,
        quota_ressources_utilise: quotas.RESOURCE_VIEW?.used ?? 0,
        quota_ressources_restant: quotas.RESOURCE_VIEW?.remaining ?? 0,
        quota_ressources_pourcentage: quotas.RESOURCE_VIEW?.pourcentage ?? 0,
        quota_ketsia_utilise: quotas.KETSIA_AI?.used ?? 0,
        quota_ketsia_restant: quotas.KETSIA_AI?.remaining ?? 0,
        quota_ketsia_pourcentage: quotas.KETSIA_AI?.pourcentage ?? 0,
        soumissions: compteurs.soumissions,
        streak_jours: streak.streak_jours,
        derniere_connexion: streak.derniere_connexion,
      },
      quotas,
    };
  }

  private async paysUtilisateur(utilisateurId: number) {
    const [ligne] = await this.dataSource.query(
      `
      SELECT pays
      FROM utilisateurs
      WHERE id = $1
      LIMIT 1
      `,
      [utilisateurId],
    );

    return ligne?.pays ?? 'benin';
  }

  /**
   * Un point par jour de la fenêtre, y compris les jours sans activité.
   *
   * `generate_series` plutôt qu'un GROUP BY seul : la heatmap a besoin d'une
   * case par jour, et faire combler les trous côté client obligerait chaque
   * appelant à refaire le même calendrier — avec le même risque de décalage
   * d'un jour.
   */
  private async serieJournaliere(utilisateurId: number, jours: number) {
    const lignes = await this.dataSource.query(
      `
      -- COUNT sur utilisateur_id et non sur id : la définition de
      -- resource_access vit dans une migration hors dépôt, et les seules
      -- colonnes dont l'usage existant atteste sont utilisateur_id,
      -- resource_type, resource_id et accessed_at. Sur un LEFT JOIN, le
      -- compte est le même — les jours sans accès donnent 0.
      SELECT
        to_char(j.jour, 'YYYY-MM-DD')                    AS date,
        COUNT(ra.utilisateur_id)::int                    AS acces
      FROM generate_series(
        CURRENT_DATE - ($2::int - 1),
        CURRENT_DATE,
        interval '1 day'
      ) AS j(jour)
      LEFT JOIN resource_access ra
        ON ra.utilisateur_id = $1
       AND ra.accessed_at >= j.jour
       AND ra.accessed_at <  j.jour + interval '1 day'
      GROUP BY j.jour
      ORDER BY j.jour
      `,
      [utilisateurId, jours],
    );
    return lignes;
  }

  /**
   * Jours consécutifs avec au moins une connexion, en remontant depuis
   * aujourd'hui — ou depuis hier.
   *
   * Repartir d'hier quand rien n'a eu lieu aujourd'hui est délibéré : sans
   * cela, la série d'un étudiant assidu retomberait à zéro chaque matin, pour
   * ne remonter qu'à sa première connexion du jour. Une série qui se brise
   * parce qu'il est 9 h ne mesure plus rien.
   *
   * Les deux `type` (« connexion » et « refresh ») comptent : la session
   * renouvelée sans ressaisie est une visite, pas une absence — c'est déjà
   * l'arbitrage retenu pour les KPI (voir LoginEvent).
   */
  private async streak(utilisateurId: number) {
    const [ligne] = await this.dataSource.query(
      `
      WITH jours AS (
        SELECT DISTINCT date_creation::date AS jour
        FROM login_events
        WHERE utilisateur_id = $1
      ),
      -- Astuce classique : sur une suite de jours consécutifs,
      -- (jour - rang) est constant. Les groupes ainsi formés sont les séries.
      groupes AS (
        SELECT jour,
               jour - (ROW_NUMBER() OVER (ORDER BY jour))::int AS serie
        FROM jours
      ),
      derniere AS (
        SELECT serie, COUNT(*)::int AS longueur, MAX(jour) AS fin
        FROM groupes
        GROUP BY serie
        ORDER BY fin DESC
        LIMIT 1
      )
      SELECT
        CASE
          WHEN fin >= CURRENT_DATE - 1 THEN longueur
          ELSE 0
        END AS streak_jours,
        (SELECT MAX(date_creation) FROM login_events WHERE utilisateur_id = $1)
          AS derniere_connexion
      FROM derniere
      `,
      [utilisateurId],
    );

    // Aucun `login_events` pour ce compte : la CTE ne rend aucune ligne.
    return {
      streak_jours: Number(ligne?.streak_jours ?? 0),
      derniere_connexion: ligne?.derniere_connexion ?? null,
    };
  }

  private async compteurs(utilisateurId: number) {
    const [acces] = await this.dataSource.query(
      `
      SELECT
        COUNT(DISTINCT resource_id) FILTER (WHERE resource_type = 'epreuve')::int
          AS epreuves_consultees,
        COUNT(DISTINCT resource_id) FILTER (WHERE resource_type = 'examen_national')::int
          AS examens_nationaux_consultes,
        COUNT(DISTINCT resource_id) FILTER (WHERE resource_type = 'concours')::int
          AS concours_consultes,
        COUNT(DISTINCT resource_type || ':' || resource_id)::int
          AS ressources_academiques_consultees
      FROM resource_access
      WHERE utilisateur_id = $1
        AND resource_type IN ('epreuve', 'examen_national', 'concours')
      `,
      [utilisateurId],
    );

    const [soumissions] = await this.dataSource.query(
      `
      SELECT COUNT(*)::int AS soumissions
      FROM epreuve_submissions
      WHERE soumis_par_id = $1
      `,
      [utilisateurId],
    );

    return {
      epreuves_consultees: Number(acces?.epreuves_consultees ?? 0),
      examens_nationaux_consultes: Number(acces?.examens_nationaux_consultes ?? 0),
      concours_consultes: Number(acces?.concours_consultes ?? 0),
      ressources_academiques_consultees: Number(acces?.ressources_academiques_consultees ?? 0),
      soumissions: Number(soumissions?.soumissions ?? 0),
    };
  }

  private enrichirQuotas(etats: Record<string, any>) {
    return Object.fromEntries(
      Object.entries(etats ?? {}).map(([feature, quota]) => {
        const used = Number(quota?.used ?? 0);
        const limit = Number(quota?.limit ?? 0);
        const remaining = Math.max(0, limit - used);
        const pourcentage = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

        return [
          feature,
          {
            ...quota,
            used,
            limit,
            remaining,
            pourcentage,
          },
        ];
      }),
    );
  }
}
