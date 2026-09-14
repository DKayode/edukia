import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { EvenementPaiementParse } from '../shared/paiement.ports';
import { MethodePaiement, StatutPaiement } from '../shared/paiement.enums';

export abstract class BaseHttpPaiementProvider {
  protected constructor(protected readonly config: ConfigService) {}

  protected async postJson(url: string, body: unknown, headers: Record<string, string>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async getJson(url: string, headers: Record<string, string>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected hmacValide(rawBody: Buffer, signature: string | undefined, secret: string | undefined): boolean {
    if (!signature || !secret) return false;
    const attendu = createHmac('sha256', secret).update(rawBody).digest('hex');
    const recu = signature.replace(/^sha256=/i, '').trim();
    const a = Buffer.from(attendu);
    const b = Buffer.from(recu);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  protected lire(headers: Record<string, string | string[] | undefined>, nom: string): string | undefined {
    const valeur = headers[nom] ?? headers[nom.toLowerCase()];
    return Array.isArray(valeur) ? valeur[0] : valeur;
  }

  protected statutDepuis(valeur: unknown): StatutPaiement {
    const statut = String(valeur ?? '').toLowerCase();
    if (['success', 'successful', 'succeeded', 'approved', 'transferred', 'paid'].includes(statut)) return StatutPaiement.REUSSI;
    if (['failed', 'failure', 'declined', 'error'].includes(statut)) return StatutPaiement.ECHOUE;
    if (['cancelled', 'canceled'].includes(statut)) return StatutPaiement.ANNULE;
    if (['expired'].includes(statut)) return StatutPaiement.EXPIRE;
    return StatutPaiement.EN_ATTENTE;
  }

  protected evenementGenerique(payload: any): EvenementPaiementParse {
    const data = payload?.data ?? payload?.transaction ?? payload;
    // KKiaPay envoie transactionId (camelCase), d'autres envoient transaction_id ou id
    const refId = data?.id ?? data?.transactionId ?? data?.transaction_id;
    return {
      evenementId: String(payload?.id ?? payload?.event_id ?? refId ?? data?.reference ?? `evt-${Date.now()}`),
      referencePrestataire: refId != null ? String(refId) : undefined,
      reference: String(data?.metadata?.reference ?? data?.reference ?? data?.external_reference ?? data?.custom_id ?? ''),
      statut: this.statutDepuis(data?.status ?? data?.transaction_status ?? payload?.status),
      montant: Number(data?.amount ?? data?.montant ?? 0),
      // FedaPay renvoie currency: { iso: "XOF" }, KKiaPay renvoie une string
      devise: typeof data?.currency === 'object' ? String(data.currency?.iso ?? 'XOF') : String(data?.currency ?? data?.devise ?? 'XOF'),
      methode: MethodePaiement.MOBILE_MONEY,
    };
  }
}
