import { api } from '../api';
import type { PaginationResponse } from '../types/pagination';

export type OrigineCode = 'INSCRIPTION' | 'ADMIN';
export type Effet = 'REDUCTION' | 'COMMISSION' | 'ABONNEMENT_OFFERT';
export type TypeRemise = 'POURCENTAGE' | 'MONTANT_FIXE';

export interface CodeEffet {
  effet: Effet;
  parametres?: Record<string, any> | null;
}

/**
 * Combinaisons refusées par le serveur, dupliquées ici pour l'expliquer AVANT
 * l'envoi — un 400 après coup n'apprend rien à l'administrateur.
 */
export const incoherence = (effets: Effet[]): string | null => {
  const a = new Set(effets);
  if (a.has('ABONNEMENT_OFFERT') && a.has('REDUCTION'))
    return "Un abonnement offert n'est pas payé : une réduction ne s'y applique pas.";
  if (a.has('ABONNEMENT_OFFERT') && a.has('COMMISSION'))
    return "Un abonnement offert n'encaisse rien : aucune commission ne peut en être tirée.";
  return null;
};

export interface ProprietaireCode {
  id: number;
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
}

export interface Code {
  id: number;
  uuid: string;
  pays: string;
  code: string;
  origine: OrigineCode;
  effets: CodeEffet[];
  proprietaire_id?: number | null;
  proprietaire?: ProprietaireCode | null;
  libelle?: string | null;
  /** `null` = illimité. */
  usage_max_total?: number | null;
  usage_max_par_utilisateur: number;
  usage_actuel: number;
  date_debut?: string | null;
  date_fin?: string | null;
  plans_eligibles?: number[] | null;
  est_actif: boolean;
  campagne?: { uuid: string; nom: string } | null;
  date_creation: string;
}

export interface CodePayload {
  code: string;
  effets: CodeEffet[];
  proprietaire_id?: number;
  libelle?: string;
  usage_max_total?: number;
  usage_max_par_utilisateur?: number;
  date_debut?: string;
  date_fin?: string;
  est_actif?: boolean;
}

export interface Campagne {
  id: number;
  uuid: string;
  nom: string;
  description?: string | null;
  prefixe?: string | null;
  nombre_codes: number;
  effets?: CodeEffet[] | null;
  date_fin?: string | null;
  date_creation: string;
  codes_generes: number;
  codes_utilises: number;
}

export interface CampagnePayload {
  nom: string;
  description?: string;
  nombre_codes: number;
  prefixe?: string;
  effets?: CodeEffet[];
  date_debut?: string;
  date_fin?: string;
}

export interface UtilisationCode {
  id: number;
  montant_remise: number;
  date_creation: string;
  utilisateur_uuid: string;
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
  abonnement_uuid?: string | null;
  statut?: string | null;
}

const query = (params?: Record<string, unknown>) => {
  if (!params) return '';
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const codesService = {
  async getAll(params?: {
    page?: number; limit?: number; origine?: OrigineCode; effet?: Effet; est_actif?: boolean; search?: string; campagne_uuid?: string;
  }): Promise<PaginationResponse<Code>> {
    return api.get<PaginationResponse<Code>>(`/admin/codes${query(params)}`);
  },

  async create(data: CodePayload): Promise<Code> {
    return api.post<Code>('/admin/codes', data);
  },

  async update(uuid: string, data: Partial<CodePayload>): Promise<Code> {
    return api.put<Code>(`/admin/codes/${uuid}`, data);
  },

  /** Désactivation logique : l'historique d'un code utilisé est conservé. */
  async desactiver(uuid: string): Promise<Code> {
    return api.delete<Code>(`/admin/codes/${uuid}`);
  },

  async getUtilisations(uuid: string): Promise<UtilisationCode[]> {
    return api.get<UtilisationCode[]>(`/admin/codes/${uuid}/utilisations`);
  },

  async getCampagnes(): Promise<Campagne[]> {
    return api.get<Campagne[]>('/admin/codes/campagnes/liste');
  },

  async genererCampagne(data: CampagnePayload): Promise<{ campagne: Campagne; codes_generes: number; demandes: number }> {
    return api.post('/admin/codes/campagnes', data);
  },

  /** L'export est un CSV brut, pas du JSON — l'API client attend du JSON. */
  urlExport(uuid: string): string {
    const base = (import.meta as any).env?.VITE_API_URL || '/backend';
    const pays = localStorage.getItem('country') || 'benin';
    return `${base}/admin/codes/campagnes/${uuid}/export?country=${pays}`;
  },

  // ── Achats groupés ────────────────────────────────────────────────────
  async commandes(params: { statut?: string; recherche?: string } = {}): Promise<CommandeGroupee[]> {
    const q = new URLSearchParams();
    if (params.statut) q.set('statut', params.statut);
    if (params.recherche) q.set('recherche', params.recherche);
    return api.get<CommandeGroupee[]>(`/admin/codes/commandes${q.toString() ? `?${q}` : ''}`);
  },

  async codesDeLaCommande(uuid: string): Promise<CodeDeCommande[]> {
    return api.get<CodeDeCommande[]>(`/admin/codes/commandes/${uuid}/codes`);
  },

  async completerCommande(uuid: string): Promise<{ codes_ajoutes: number }> {
    return api.post<{ codes_ajoutes: number }>(`/admin/codes/commandes/${uuid}/completer`, {});
  },
};

/** Libellé lisible des effets d'un code — un code sans effet ne fait rien. */
export const libelleEffets = (effets?: CodeEffet[] | null): string => {
  if (!effets?.length) return '—';
  return effets
    .map((e) => {
      if (e.effet === 'REDUCTION') {
        const p = e.parametres ?? {};
        return p.type === 'POURCENTAGE'
          ? `−${p.valeur} %`
          : `−${Number(p.valeur ?? 0).toLocaleString('fr-FR')} XOF`;
      }
      if (e.effet === 'COMMISSION') return e.parametres?.taux ? `Commission ${e.parametres.taux} %` : 'Commission';
      if (e.effet === 'ABONNEMENT_OFFERT') {
        const j = e.parametres?.duree_jours;
        return j ? `Abonnement offert (${j} j)` : 'Abonnement offert';
      }
      return e.effet;
    })
    .join(' · ');
};

/** `usage_max_total` à `null` veut dire illimité, pas zéro. */
export const libelleUsage = (c: Code): string =>
  c.usage_max_total == null ? `${c.usage_actuel} / ∞` : `${c.usage_actuel} / ${c.usage_max_total}`;

export interface CommandeGroupee {
  uuid: string;
  statut: 'EN_ATTENTE' | 'PAYEE' | 'ANNULEE' | 'REMBOURSEE';
  quantite: number;
  codes_livres: number;
  /** Commande payée dont les codes manquent — un incident à traiter. */
  livraison_incomplete: boolean;
  prix_unitaire: number;
  montant_total: number;
  devise: string;
  plan: { code?: string; libelle?: string };
  acheteur: { nom: string | null; email: string | null };
  date_creation: string;
  date_paiement: string | null;
}

export interface CodeDeCommande {
  code: string;
  utilise_le: string | null;
  beneficiaire_email: string | null;
  beneficiaire_nom: string | null;
}
