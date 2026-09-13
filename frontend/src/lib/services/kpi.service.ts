import { api } from '../api';

export interface AgeRanges {
  moins_18: number;
  de_18_25: number;
  de_26_35: number;
  plus_35: number;
}

// Mirrors the backend GET /kpi payload (grouped by section). Country is
// auto-appended by the api client (withCountryQuery) — don't add pays here.
export interface KpiResponse {
  pays: string;
  periode: { startDate: string; endDate: string };
  utilisateurs: {
    total: number;              // KPI 2
    professeurs: number;
    autres: number;
    age_35_max: number;         // KPI 3
    age_ranges: AgeRanges;
    femmes: number;             // KPI 4
    femmes_35_max: number;      // KPI 5
    zone_rurale: number;        // KPI 6
    situation_handicap: number; // KPI 7
    connectes: number;          // KPI 8
  };
  apprenants: {
    total: number;              // KPI 9
    age_35_max: number;         // KPI 10
    age_ranges: AgeRanges;
    age_35_max_femmes: number;  // KPI 11
    femmes: number;             // KPI 12
    zone_rurale: number;        // KPI 13
    situation_handicap: number; // KPI 14
  };
  engagement: {
    apprenants_actifs: number;
    apprenants_connectes: number; // KPI 15
    apprenants_ressource: {       // KPI 16
      semaine: number;
      deux_semaines: number;
      mois: number;
    };
  };
  // ── #260 — suivi des autres modules ──────────────────────────────────────
  audience: {
    modules: ModuleAudience[];
    opportunites?: {
      bourses: { vues: number; utilisateurs: number };
      stages: { vues: number; utilisateurs: number };
    };
    total_vues: number;
    /** Jamais la somme des `utilisateurs` par module : qui visite deux modules
     *  n'est compté qu'une fois. */
    utilisateurs_distincts: number;
  };
  contenu: { type: string; libelle: string; publies: number; total: number }[];
  communaute: {
    forums_ouverts: number;
    commentaires: number;
    commentateurs: number;
    likes: number;
    likeurs: number;
  };
  jobkia: {
    prestataires_inscrits: number;
    prestataires_total: number;
    recruteurs_inscrits: number;
    recruteurs_total: number;
    services_publies: number;
    offres_publiees: number;
    avis_deposes: number;
  };
  croissance: {
    activation: { cohorte: number; actives: number; taux: number };
    retention: { j7: number; j30: number };
    assiduite: { wau: number; mau: number; collage: number };
    profil: { completion_moyenne: number; comptes: number };
    monetisation: {
      abonnements_actifs: number;
      abonnements_souscrits: number;
      portefeuilles: number;
      transactions: number;
    };
  };
  /** Depuis quand chaque journal existe. Une période antérieure lit 0 par
   *  absence d'historique, pas par absence d'usage. */
  journaux: {
    ressources_depuis: string | null;
    connexions_depuis: string | null;
    audience_modules_depuis: string | null;
  };
}

export interface ModuleAudience {
  type: string;
  libelle: string;
  vues: number;
  utilisateurs: number;
  top: { id: number; titre: string; vues: number; utilisateurs: number }[];
}

export const kpiService = {
  async getKpis(startDate: string, endDate: string): Promise<KpiResponse> {
    return api.get<KpiResponse>(`/kpi?startDate=${startDate}&endDate=${endDate}`);
  },
};
