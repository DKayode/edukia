import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseHttpPaiementProvider } from './base-http.provider';
import { InitierPaiementCommande, PaiementProviderPort } from '../shared/paiement.ports';
import { ModePaiement, PrestatairePaiement } from '../shared/paiement.enums';

@Injectable()
export class FedaPayProvider extends BaseHttpPaiementProvider implements PaiementProviderPort {
  readonly code = PrestatairePaiement.FEDAPAY;

  constructor(config: ConfigService) {
    super(config);
  }

  async initier(cmd: InitierPaiementCommande) {
    const credentials = cmd.credentials ?? {};
    const baseUrl = this.baseUrl(credentials, cmd.mode);
    const payload = {
      description: `Abonnement Edukia ${cmd.reference}`,
      amount: cmd.montant,
      currency: { iso: cmd.devise },
      callback_url: cmd.urlWebhook,
      return_url: cmd.urlRetour,
      customer: {
        firstname: cmd.client.nom,
        email: cmd.client.email,
        ...(cmd.client.telephone ? {
          phone_number: {
            number: cmd.client.telephone.trim(),
            country: this.devinerPaysTelephone(cmd.client.telephone),
          },
        } : {}),
      },
      metadata: { ...cmd.metadata, reference: cmd.reference },
    };
    const authHeader = {
      Authorization: `Bearer ${credentials.secret_key ?? this.config.get<string>('FEDAPAY_SECRET_KEY') ?? ''}`,
    };
    const reponse = await this.postJson(`${baseUrl}/transactions`, payload, authHeader);
    const data = reponse?.['v1/transaction'] ?? reponse?.transaction ?? reponse?.data ?? reponse;
    const transactionId = data?.id;

    let urlPaiement = data?.payment_url ?? data?.url ?? null;
    let tokenClient = data?.token ?? null;

    if (!urlPaiement && transactionId) {
      try {
        const tokenReponse = await this.postJson(`${baseUrl}/transactions/${transactionId}/token`, {}, authHeader);
        const tokenData = tokenReponse?.['v1/token'] ?? tokenReponse?.token ?? tokenReponse?.data ?? tokenReponse;
        urlPaiement = tokenData?.url ?? tokenReponse?.url ?? null;
        tokenClient = typeof tokenData === 'string' ? tokenData : tokenData?.token ?? null;
      } catch {
        // En cas d'erreur de génération de token, urlPaiement restera null
      }
    }

    return {
      referencePrestataire: String(transactionId ?? cmd.reference),
      urlPaiement,
      tokenClient,
      payload: reponse,
    };
  }

  verifierSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, credentials?: Record<string, string>): boolean {
    const secret = credentials?.webhook_secret ?? this.config.get<string>('FEDAPAY_WEBHOOK_SECRET');
    const header = this.lire(headers, 'x-fedapay-signature');
    if (!header || !secret) return false;

    // Format officiel FedaPay: t=timestamp,s=signature (hash_hmac de t.payload)
    if (header.includes('t=') && header.includes('s=')) {
      try {
        const parts = header.split(',');
        let t = '';
        let s = '';
        for (const part of parts) {
          const [k, v] = part.split('=', 2);
          if (k?.trim() === 't') t = v?.trim() ?? '';
          if (k?.trim() === 's') s = v?.trim() ?? '';
        }
        if (!t || !s) return false;
        const attendu = createHmac('sha256', secret).update(t + '.' + rawBody.toString('utf8')).digest('hex');
        const a = Buffer.from(attendu);
        const b = Buffer.from(s);
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    }

    return this.hmacValide(rawBody, header, secret);
  }

  parserWebhook(payload: unknown) {
    return this.evenementGenerique(payload);
  }

  async verifierStatut(referencePrestataire: string, credentials?: Record<string, string>, mode?: ModePaiement) {
    const baseUrl = this.baseUrl(credentials, mode);
    const reponse = await this.getJson(`${baseUrl}/transactions/${referencePrestataire}`, {
      Authorization: `Bearer ${credentials?.secret_key ?? this.config.get<string>('FEDAPAY_SECRET_KEY') ?? ''}`,
    });
    const data = reponse?.['v1/transaction'] ?? reponse?.transaction ?? reponse?.data ?? reponse;
    const devise = typeof data?.currency === 'object' ? (data.currency?.iso ?? 'XOF') : (data?.currency ?? 'XOF');
    return { statut: this.statutDepuis(data?.status), montant: Number(data?.amount ?? 0), devise };
  }

  private baseUrl(credentials?: Record<string, string>, mode?: ModePaiement): string {
    const envKey = mode === ModePaiement.LIVE ? 'FEDAPAY_LIVE_API_BASE_URL' : 'FEDAPAY_SANDBOX_API_BASE_URL';
    const defaut = mode === ModePaiement.LIVE ? 'https://api.fedapay.com/v1' : 'https://sandbox-api.fedapay.com/v1';
    return credentials?.api_base_url
      ?? this.config.get<string>(envKey)
      ?? this.config.get<string>('FEDAPAY_API_BASE_URL')
      ?? defaut;
  }

  private devinerPaysTelephone(tel: string): string {
    const net = tel.replace(/[^0-9]/g, '');
    if (net.startsWith('229')) return 'bj';
    if (net.startsWith('225')) return 'ci';
    if (net.startsWith('228')) return 'tg';
    if (net.startsWith('221')) return 'sn';
    if (net.startsWith('226')) return 'bf';
    if (net.startsWith('223')) return 'ml';
    if (net.startsWith('227')) return 'ne';
    return 'bj';
  }

}
