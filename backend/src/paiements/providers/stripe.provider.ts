import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { BaseHttpPaiementProvider } from './base-http.provider';
import { InitierPaiementCommande, PaiementProviderPort, ResultatInitiationPaiement, EvenementPaiementParse } from '../shared/paiement.ports';
import { MethodePaiement, ModePaiement, PrestatairePaiement, StatutPaiement } from '../shared/paiement.enums';

// Devises sans centimes (zero-decimal) selon Stripe
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

@Injectable()
export class StripeProvider extends BaseHttpPaiementProvider implements PaiementProviderPort {
  readonly code = PrestatairePaiement.STRIPE;

  constructor(config: ConfigService) {
    super(config);
  }

  private getStripe(secretKey: string): Stripe {
    const StripeLib: any = require('stripe');
    const StripeConstructor = StripeLib.default || StripeLib;
    return new StripeConstructor(secretKey);
  }

  async initier(cmd: InitierPaiementCommande): Promise<ResultatInitiationPaiement> {
    const credentials = cmd.credentials ?? {};
    const secretKey = credentials.secret_key ?? this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const stripe = this.getStripe(secretKey);

    const devise = cmd.devise.toLowerCase();
    const unitAmount = this.toStripeAmount(cmd.montant, devise);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: cmd.client.email,
      client_reference_id: cmd.reference,
      line_items: [
        {
          price_data: {
            currency: devise,
            product_data: {
              name: `Abonnement Edukia ${cmd.reference}`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          ...cmd.metadata,
          reference: cmd.reference,
        },
      },
      success_url: `${cmd.urlRetour}&id={CHECKOUT_SESSION_ID}&status=approved`,
      cancel_url: `${cmd.urlRetour}&status=canceled`,
      metadata: {
        ...cmd.metadata,
        reference: cmd.reference,
      },
    });

    return {
      referencePrestataire: session.id,
      urlPaiement: session.url,
      tokenClient: session.id,
      payload: session,
    };
  }

  verifierSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, credentials?: Record<string, string>): boolean {
    const secretKey = credentials?.secret_key ?? this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const webhookSecret = credentials?.webhook_secret ?? this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    const sigHeader = this.lire(headers, 'stripe-signature');

    if (!sigHeader || !webhookSecret || !secretKey) return false;

    try {
      const stripe = this.getStripe(secretKey);
      stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parserWebhook(payload: any): EvenementPaiementParse {
    const event = payload;
    const session = event?.data?.object;

    let statut = StatutPaiement.EN_ATTENTE;
    if (event?.type === 'checkout.session.completed') {
      statut = session?.payment_status === 'paid' ? StatutPaiement.REUSSI : StatutPaiement.EN_ATTENTE;
    } else if (event?.type === 'checkout.session.expired') {
      statut = StatutPaiement.EXPIRE;
    } else if (event?.type === 'payment_intent.payment_failed') {
      statut = StatutPaiement.ECHOUE;
    }

    const currency = session?.currency ? session.currency.toUpperCase() : 'EUR';
    const rawAmount = session?.amount_total ?? session?.amount ?? 0;
    const montant = this.fromStripeAmount(rawAmount, currency);

    return {
      evenementId: String(event?.id ?? `evt-stripe-${Date.now()}`),
      referencePrestataire: session?.id ? String(session.id) : undefined,
      reference: String(session?.metadata?.reference ?? session?.client_reference_id ?? ''),
      statut,
      montant,
      devise: currency,
      methode: MethodePaiement.CARTE,
    };
  }

  async verifierStatut(referencePrestataire: string, credentials?: Record<string, string>, mode?: ModePaiement) {
    const secretKey = credentials?.secret_key ?? this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const stripe = this.getStripe(secretKey);

    const session = await stripe.checkout.sessions.retrieve(referencePrestataire);
    const isPaid = session.payment_status === 'paid';
    const isExpired = session.status === 'expired';
    const statut = isPaid ? StatutPaiement.REUSSI : (isExpired ? StatutPaiement.EXPIRE : StatutPaiement.EN_ATTENTE);
    const devise = (session.currency ?? 'eur').toUpperCase();
    const montant = this.fromStripeAmount(session.amount_total ?? 0, devise);

    return { statut, montant, devise };
  }

  private toStripeAmount(montant: number, devise: string): number {
    if (ZERO_DECIMAL_CURRENCIES.has(devise.toLowerCase())) {
      return Math.round(montant);
    }
    return Math.round(montant * 100);
  }

  private fromStripeAmount(montant: number, devise: string): number {
    if (ZERO_DECIMAL_CURRENCIES.has(devise.toLowerCase())) {
      return montant;
    }
    return montant / 100;
  }
}
