import { api } from '../api';
import type { PaginationParams, PaginationResponse } from '../types/pagination';

export type StatutAbonnement = 'EN_ATTENTE' | 'ACTIF' | 'EXPIRE' | 'ANNULE' | 'REMBOURSE';

export interface PlanAbonnement {
  id: number;
  uuid: string;
  pays: string;
  code: string;
  libelle: string;
  description?: string | null;
  prix: number;
  devise: string;
  duree_jours: number;
  est_actif: boolean;
  ordre_affichage: number;
  date_creation: string;
  date_modification: string;
}

export interface PlanPayload {
  code: string;
  libelle: string;
  description?: string;
  prix: number;
  devise?: string;
  duree_jours: number;
  est_actif?: boolean;
  ordre_affichage?: number;
}

export interface AbonnementUtilisateur {
  id: number;
  uuid?: string;
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
}

export interface Abonnement {
  id: number;
  uuid: string;
  pays: string;
  utilisateur_id: number;
  parrain_id?: number | null;
  commission_versee?: boolean;
  statut: StatutAbonnement;
  date_debut?: string | null;
  date_fin?: string | null;
  montant_paye: number;
  devise: string;
  metadata?: Record<string, unknown> | null;
  date_creation: string;
  plan?: PlanAbonnement | null;
  utilisateur?: AbonnementUtilisateur | null;
}

export interface AbonnementEvenement {
  id: number;
  type: string;
  payload?: Record<string, unknown> | null;
  date_creation: string;
}

export type FeatureQuota = 'RESOURCE_VIEW' | 'KETSIA_AI';
export type PeriodeReset = 'MENSUEL' | 'AVIE';

export interface EtatVerrou {
  verrou_actif: boolean;
  /** `base` : une bascule enregistrée fait autorité. `environnement` : valeur de déploiement. */
  origine: 'base' | 'environnement';
  valeur_environnement: boolean;
  date_modification: string | null;
  modifie_par: number | null;
}

export interface ConfigurationQuota {
  id: number;
  uuid: string;
  pays: string;
  feature: FeatureQuota;
  limite: number;
  periode_reset: PeriodeReset;
  est_actif: boolean;
  date_modification: string;
}

export interface QuotaPayload {
  limite?: number;
  periode_reset?: PeriodeReset;
  est_actif?: boolean;
}

export interface ReglageCommission {
  taux: number;
  est_active: boolean;
  devise: string;
  /** Un taux à 0 ne verse rien, même « activé ». */
  verse_effectivement: boolean;
}

export interface LigneClassement {
  rang: number;
  uuid: string;
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
  code?: string | null;
  nombre_commissions: number;
  abonnements: number;
  total: number;
  derniere: string;
}

export interface ClassementCommissions {
  periode: { startDate: string | null; endDate: string | null };
  totaux: { beneficiaires: number; nombre_commissions: number; total: number };
  classement: LigneClassement[];
}

export interface ActivationPayload {
  montant_paye: number;
  reference_paiement?: string;
  commentaire?: string;
}

export type AbonnementFilters = PaginationParams & {
  statut?: StatutAbonnement;
  plan_code?: string;
  search?: string;
};

const query = (params?: Record<string, unknown> | AbonnementFilters) => {
  if (!params) return '';
  const qs = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const abonnementsService = {
  // ── Plans ────────────────────────────────────────────────────────────────
  /** Vue admin : inclut les plans fermés, invisibles du catalogue mobile. */
  async getPlans(): Promise<PlanAbonnement[]> {
    return api.get<PlanAbonnement[]>('/admin/abonnements/plans');
  },

  async createPlan(data: PlanPayload): Promise<PlanAbonnement> {
    return api.post<PlanAbonnement>('/admin/abonnements/plans', data);
  },

  async updatePlan(uuid: string, data: Partial<PlanPayload>): Promise<PlanAbonnement> {
    return api.put<PlanAbonnement>(`/admin/abonnements/plans/${uuid}`, data);
  },

  /** Fermeture logique : un plan référencé par un abonnement ne disparaît pas. */
  async fermerPlan(uuid: string): Promise<PlanAbonnement> {
    return api.delete<PlanAbonnement>(`/admin/abonnements/plans/${uuid}`);
  },

  // ── Quotas gratuits ──────────────────────────────────────────────────────
  async getVerrou(): Promise<EtatVerrou> {
    return api.get<EtatVerrou>('/admin/abonnements/verrou');
  },

  async setVerrou(verrou_actif: boolean): Promise<EtatVerrou> {
    return api.put<EtatVerrou>('/admin/abonnements/verrou', { verrou_actif });
  },

  async getQuotas(): Promise<ConfigurationQuota[]> {
    return api.get<ConfigurationQuota[]>('/admin/abonnements/quotas');
  },

  async updateQuota(uuid: string, data: QuotaPayload): Promise<ConfigurationQuota> {
    return api.put<ConfigurationQuota>(`/admin/abonnements/quotas/${uuid}`, data);
  },

  // ── Commission de parrainage ─────────────────────────────────────────────
  async getCommission(): Promise<ReglageCommission> {
    return api.get<ReglageCommission>('/admin/abonnements/commission');
  },

  async updateCommission(data: { taux?: number; est_active?: boolean }): Promise<ReglageCommission> {
    return api.put<ReglageCommission>('/admin/abonnements/commission', data);
  },

  async getClassementCommissions(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<ClassementCommissions> {
    return api.get<ClassementCommissions>(`/admin/abonnements/classement-commissions${query(params)}`);
  },

  // ── Abonnements ──────────────────────────────────────────────────────────
  async getAbonnements(filters?: AbonnementFilters): Promise<PaginationResponse<Abonnement>> {
    return api.get<PaginationResponse<Abonnement>>(`/admin/abonnements${query(filters)}`);
  },

  async getEvenements(uuid: string): Promise<AbonnementEvenement[]> {
    return api.get<AbonnementEvenement[]>(`/admin/abonnements/${uuid}/evenements`);
  },

  /** Activation d'un abonnement encaissé hors application. */
  async activer(uuid: string, data: ActivationPayload): Promise<Abonnement> {
    return api.post<Abonnement>(`/admin/abonnements/${uuid}/activer`, data);
  },

  /** Abonnements actifs dont la commission de parrainage n'est pas passée. */
  async getCommissionsEnAttente(): Promise<Abonnement[]> {
    return api.get<Abonnement[]>('/admin/abonnements/commissions-en-attente');
  },

  async rattraperCommission(uuid: string): Promise<{ verse: boolean; motif?: string }> {
    return api.post<{ verse: boolean; motif?: string }>(`/admin/abonnements/${uuid}/rattraper-commission`, {});
  },

  async prolonger(uuid: string, jours: number, motif?: string): Promise<Abonnement> {
    return api.post<Abonnement>(`/admin/abonnements/${uuid}/prolonger`, { jours, motif });
  },

  async annuler(uuid: string, motif?: string): Promise<Abonnement> {
    return api.post<Abonnement>(`/admin/abonnements/${uuid}/annuler`, { motif });
  },
};

/**
 * Un abonnement peut être ACTIF en base avec une date de fin dépassée : la
 * bascule vers EXPIRE est écrite par une tâche horaire. Le serveur, lui, refuse
 * déjà l'accès. Afficher « actif » sur le seul statut mentirait à l'admin.
 */
export const estReellementActif = (a: Abonnement): boolean =>
  a.statut === 'ACTIF' && !!a.date_fin && new Date(a.date_fin) > new Date();
