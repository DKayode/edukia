import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import kkiapay from '@kkiapay-org/nodejs-sdk';
import { BaseHttpPaiementProvider } from './base-http.provider';
import { InitierPaiementCommande, PaiementProviderPort } from '../shared/paiement.ports';
import { ModePaiement, PrestatairePaiement, StatutPaiement } from '../shared/paiement.enums';

@Injectable()
export class KkiaPayProvider extends BaseHttpPaiementProvider implements PaiementProviderPort {
  readonly code = PrestatairePaiement.KKIAPAY;

  constructor(config: ConfigService) {
    super(config);
  }

  async initier(cmd: InitierPaiementCommande) {
    const credentials = cmd.credentials ?? {};
    if (credentials.checkout_mode !== 'api') {
      const publicKey = credentials.public_key ?? this.config.get<string>('KKIAPAY_PUBLIC_KEY') ?? '';
      return {
        urlPaiement: null,
        tokenClient: null,
        payload: {
          integration: 'widget',
          widget: {
            sandbox: cmd.mode === ModePaiement.SANDBOX,
            amount: cmd.montant,
            currency: cmd.devise,
            key: publicKey,
            callback: cmd.urlRetour,
            data: cmd.reference,
            reference: cmd.reference,
            metadata: cmd.metadata,
          },
        },
      };
    }

    const baseUrl = this.baseUrl(credentials, cmd.mode);
    const payload = {
      amount: cmd.montant,
      currency: cmd.devise,
      callback: cmd.urlWebhook,
      return_url: cmd.urlRetour,
      phone: cmd.client.telephone,
      name: cmd.client.nom,
      email: cmd.client.email,
      reason: `Abonnement Edukia ${cmd.reference}`,
      metadata: { ...cmd.metadata, reference: cmd.reference },
    };
    const reponse = await this.postJson(`${baseUrl}/api/v1/transactions/init`, payload, {
      'x-api-key': credentials.public_key ?? this.config.get<string>('KKIAPAY_PUBLIC_KEY') ?? '',
      'x-private-key': credentials.private_key ?? this.config.get<string>('KKIAPAY_PRIVATE_KEY') ?? '',
    });
    return {
      referencePrestataire: String(reponse?.transactionId ?? reponse?.transaction_id ?? reponse?.id ?? cmd.reference),
      urlPaiement: reponse?.payment_url ?? reponse?.url ?? null,
      tokenClient: reponse?.token ?? null,
      payload: reponse,
    };
  }

  verifierSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, credentials?: Record<string, string>): boolean {
    return this.hmacValide(rawBody, this.lire(headers, 'x-kkiapay-secret') ?? this.lire(headers, 'x-kkiapay-signature'), credentials?.webhook_secret ?? credentials?.secret ?? this.config.get<string>('KKIAPAY_SECRET'));
  }

  parserWebhook(payload: unknown) {
    return this.evenementGenerique(payload);
  }

  async verifierStatut(referencePrestataire: string, credentials?: Record<string, string>, mode?: ModePaiement) {
    const client = kkiapay({
      publickey: credentials?.public_key ?? this.config.get<string>('KKIAPAY_PUBLIC_KEY') ?? '',
      privatekey: credentials?.private_key ?? this.config.get<string>('KKIAPAY_PRIVATE_KEY') ?? '',
      secretkey: credentials?.secret ?? credentials?.webhook_secret ?? this.config.get<string>('KKIAPAY_SECRET') ?? '',
      sandbox: mode !== ModePaiement.LIVE,
    });
    const reponse = await client.verify(referencePrestataire);
    const data = reponse?.data ?? reponse;
    return {
      statut: this.statutDepuis(data?.status ?? data?.state),
      montant: Number(data?.amount ?? data?.amountDebited ?? 0),
      devise: data?.currency ?? data?.currencyCode ?? 'XOF',
    };
  }

  private baseUrl(credentials?: Record<string, string>, mode?: ModePaiement): string {
    const envKey = mode === ModePaiement.LIVE ? 'KKIAPAY_LIVE_API_BASE_URL' : 'KKIAPAY_SANDBOX_API_BASE_URL';
    return credentials?.api_base_url
      ?? this.config.get<string>(envKey)
      ?? this.config.get<string>('KKIAPAY_API_BASE_URL')
      ?? 'https://api.kkiapay.me';
  }
}
