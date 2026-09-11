import { api } from '../api';

export interface ChampProfil {
  champ: string;
  libelle: string;
  /** Combien de comptes actifs ont réellement rempli ce champ. */
  remplis: number;
  /** Le même, en pourcentage des comptes actifs. */
  part: number;
}

export interface ReglageProfil {
  uuid: string;
  pays: string;
  seuil_completion: number;
  est_actif: boolean;
  champs_exclus: string[] | null;
  champs_disponibles: ChampProfil[];
}

export interface DistributionProfil {
  total: number;
  champs_comptes: number;
  repartition: { pourcentage: number; comptes: number }[];
  passeraient: { seuil: number; comptes: number; part: number }[];
}

export interface ReglageProfilPayload {
  seuil_completion?: number;
  est_actif?: boolean;
  champs_exclus?: string[];
}

export const profilCompletionService = {
  async getReglage(): Promise<ReglageProfil> {
    return api.get<ReglageProfil>('/admin/profil-completion');
  },

  async updateReglage(data: ReglageProfilPayload): Promise<ReglageProfil> {
    return api.put<ReglageProfil>('/admin/profil-completion', data);
  },

  async getDistribution(): Promise<DistributionProfil> {
    return api.get<DistributionProfil>('/admin/profil-completion/distribution');
  },
};
