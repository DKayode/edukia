import { api } from '../api';
import { buildPaginationQuery, type PaginationParams, type PaginationResponse } from '../types/pagination';

export type PrestatairePaiement = 'KKIAPAY' | 'FEDAPAY' | 'STRIPE' | 'REVENUECAT';
export type ModePaiement = 'sandbox' | 'live';

export interface ConfigurationPaiement {
  id: number;
  uuid: string;
  pays: string;
  prestataire: PrestatairePaiement;
  mode: ModePaiement;
  devise: string;
  montant_min: number | null;
  montant_max: number | null;
  est_actif: boolean;
  credentials_masquees?: Record<string, string> | null;
  date_modification: string;
}

export interface ConfigurationPaiementUpdate {
  prestataire: PrestatairePaiement;
  mode: ModePaiement;
  devise?: string;
  montant_min?: number | null;
  montant_max?: number | null;
  est_actif?: boolean;
  credentials?: Record<string, string>;
}

export type StatutPaiement = 'INITIE' | 'EN_ATTENTE' | 'REUSSI' | 'ECHOUE' | 'ANNULE' | 'EXPIRE' | 'REMBOURSE';
export type IssuePaiement = 'ABOUTI' | 'NON_ABOUTI';

export interface TentativePaiement {
  uuid: string;
  reference: string;
  prestataire: PrestatairePaiement;
  statut: StatutPaiement;
  montant: number;
  devise: string;
  abonnement_id: number | null;
  commande_id: number | null;
  date_creation: string;
  date_confirmation: string | null;
}

export interface SuiviUtilisateur {
  utilisateur: { uuid: string; nom: string | null; prenom: string | null; email: string | null; telephone: string | null };
  issue: IssuePaiement;
  tentatives: number;
  reussies: number;
  dernier_statut: StatutPaiement;
  derniere_tentative: string;
  montant_paye: { devise: string; montant: number }[];
  paiements: TentativePaiement[];
}

export interface SuiviPaiements extends PaginationResponse<SuiviUtilisateur> {
  resume: {
    utilisateurs: number;
    aboutis: number;
    non_aboutis: number;
    tentatives: number;
    taux_conversion: number;
    encaisse: { devise: string; montant: number }[];
  };
}

export interface SuiviFiltres {
  page?: number;
  limit?: number;
  issue?: IssuePaiement;
  depuis?: string;
  jusqua?: string;
  search?: string;
}

export const paiementsAdminService = {
  getConfigurations: () => api.get<ConfigurationPaiement[]>('/admin/paiements/configurations'),
  saveConfiguration: (payload: ConfigurationPaiementUpdate) =>
    api.post<ConfigurationPaiement>('/admin/paiements/configurations', payload),
  getSuivi: (filtres: SuiviFiltres) =>
    api.get<SuiviPaiements>(`/admin/paiements/suivi${buildPaginationQuery(filtres as SuiviFiltres & PaginationParams)}`),
};
