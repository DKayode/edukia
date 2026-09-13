import { api } from '../api';

export type PrestatairePaiement = 'KKIAPAY' | 'FEDAPAY';
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

export const paiementsAdminService = {
  getConfigurations: () => api.get<ConfigurationPaiement[]>('/admin/paiements/configurations'),
  saveConfiguration: (payload: ConfigurationPaiementUpdate) =>
    api.post<ConfigurationPaiement>('/admin/paiements/configurations', payload),
};
