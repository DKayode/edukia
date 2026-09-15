import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseHttpPaiementProvider } from './base-http.provider';
import { InitierPaiementCommande, PaiementProviderPort } from '../shared/paiement.ports';
import { MethodePaiement, ModePaiement, PrestatairePaiement, StatutPaiement } from '../shared/paiement.enums';

/** RevenueCat est payé par le SDK App Store / Google Play côté mobile. */
@Injectable()
export class RevenueCatProvider extends BaseHttpPaiementProvider implements PaiementProviderPort {
  readonly code = PrestatairePaiement.REVENUECAT;

  constructor(config: ConfigService) {
    super(config);
  }

  async initier(_cmd: InitierPaiementCommande): Promise<never> {
    throw new BadRequestException(
      'RevenueCat doit être initié par le SDK mobile App Store ou Google Play',
    );
  }

  verifierSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    credentials?: Record<string, string>,
  ): boolean {
    const configuredAuthorization = credentials?.webhook_authorization
      ?? this.config.get<string>('REVENUECAT_WEBHOOK_AUTHORIZATION');
    const authorization = this.lire(headers, 'authorization');
    if (configuredAuthorization && authorization === configuredAuthorization) return true;

    const signature = this.lire(headers, 'x-revenuecat-webhook-signature');
    const secret = credentials?.webhook_secret ?? this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (!signature || !secret) return false;
    const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=', 2) as [string, string]));
    if (!parts.t || !parts.v1) return false;
    const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody.toString('utf8')}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parserWebhook(payload: unknown) {
    const event = (payload as any)?.event ?? {};
    const type = String(event.type ?? '').toUpperCase();
    const successful = ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED'].includes(type);
    const status = successful
      ? StatutPaiement.REUSSI
      : ['EXPIRATION', 'CANCELLATION'].includes(type)
        ? StatutPaiement.EXPIRE
        : type === 'BILLING_ISSUE' ? StatutPaiement.ECHOUE : StatutPaiement.EN_ATTENTE;
    const amount = Number(event.price_in_purchased_currency ?? event.price ?? 0);
    return {
      evenementId: String(event.id ?? `revenuecat-${Date.now()}`),
      referencePrestataire: event.transaction_id ? String(event.transaction_id) : undefined,
      reference: String(event.app_user_id ?? ''),
      statut: status,
      montant: Number.isFinite(amount) ? amount : 0,
      devise: String(event.currency ?? 'USD'),
      methode: MethodePaiement.IAP,
    };
  }

  async verifierStatut(referencePrestataire: string, credentials?: Record<string, string>, _mode?: ModePaiement) {
    const apiKey = credentials?.secret_key ?? this.config.get<string>('REVENUECAT_SECRET_KEY');
    const appUserId = encodeURIComponent(referencePrestataire);
    const response = await this.getJson(`https://api.revenuecat.com/v1/subscribers/${appUserId}`, {
      Authorization: `Bearer ${apiKey ?? ''}`,
    });
    const subscriber = response?.subscriber ?? {};
    const active = Object.values(subscriber.subscriptions ?? {}).some((subscription: any) =>
      !subscription.expires_date || new Date(subscription.expires_date) > new Date(),
    );
    return { statut: active ? StatutPaiement.REUSSI : StatutPaiement.EXPIRE, montant: 0, devise: 'USD' };
  }
}
