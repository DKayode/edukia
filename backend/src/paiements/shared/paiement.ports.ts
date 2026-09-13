import { MethodePaiement, ModePaiement, PrestatairePaiement, StatutPaiement } from './paiement.enums';

export interface InitierPaiementCommande {
  reference: string;
  mode: ModePaiement;
  montant: number;
  devise: string;
  client: { nom: string; email: string; telephone?: string };
  urlRetour: string;
  urlWebhook: string;
  metadata?: Record<string, unknown>;
  credentials?: Record<string, string>;
}

export interface ResultatInitiationPaiement {
  referencePrestataire?: string;
  urlPaiement?: string;
  tokenClient?: string;
  payload?: unknown;
}

export interface EvenementPaiementParse {
  evenementId: string;
  referencePrestataire?: string;
  reference: string;
  statut: StatutPaiement;
  montant: number;
  devise: string;
  methode?: MethodePaiement;
}

export interface PaiementProviderPort {
  readonly code: PrestatairePaiement;
  initier(cmd: InitierPaiementCommande): Promise<ResultatInitiationPaiement>;
  verifierSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, credentials?: Record<string, string>): boolean;
  parserWebhook(payload: unknown): EvenementPaiementParse;
  verifierStatut(referencePrestataire: string, credentials?: Record<string, string>, mode?: ModePaiement): Promise<{ statut: StatutPaiement; montant: number; devise?: string }>;
}
