import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ModePaiement, PrestatairePaiement, StatutPaiement } from '../shared/paiement.enums';
import { FedaPayProvider } from './fedapay.provider';
import { KkiaPayProvider } from './kkiapay.provider';
import { StripeProvider } from './stripe.provider';

describe('Providers Paiement (KKiaPay, FedaPay, Stripe)', () => {
  let config: jest.Mocked<ConfigService>;
  let kkiapayProvider: KkiaPayProvider;
  let fedapayProvider: FedaPayProvider;
  let stripeProvider: StripeProvider;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'KKIAPAY_SECRET') return 'test-kkiapay-secret';
        if (key === 'FEDAPAY_WEBHOOK_SECRET') return 'test-fedapay-secret';
        if (key === 'KKIAPAY_PUBLIC_KEY') return 'pk_test';
        if (key === 'FEDAPAY_SECRET_KEY') return 'sk_test';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_123';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test_123';
        return undefined;
      }),
    } as any;
    kkiapayProvider = new KkiaPayProvider(config);
    fedapayProvider = new FedaPayProvider(config);
    stripeProvider = new StripeProvider(config);
  });

  describe('KKiaPayProvider', () => {
    it('génère un widget avec la propriété data pour la référence', async () => {
      const init = await kkiapayProvider.initier({
        reference: 'EDK-12345',
        mode: ModePaiement.SANDBOX,
        montant: 2000,
        devise: 'XOF',
        client: { nom: 'Jean Dupont', email: 'jean@test.com' },
        urlRetour: 'https://app.edukia.com/retour',
        urlWebhook: 'https://api.edukia.com/paiements/webhooks/kkiapay',
      });

      expect((init.payload as any)?.widget?.data).toBe('EDK-12345');
      expect((init.payload as any)?.widget?.reference).toBe('EDK-12345');
    });

    it('valide la signature avec le header x-kkiapay-secret', () => {
      const rawBody = Buffer.from(JSON.stringify({ transactionId: 'TXN-999', status: 'SUCCESS' }));
      const hash = createHmac('sha256', 'test-kkiapay-secret').update(rawBody).digest('hex');

      const valide = kkiapayProvider.verifierSignature(rawBody, {
        'x-kkiapay-secret': hash,
      });

      expect(valide).toBe(true);
    });

    it('parse correctement le webhook KKiaPay avec transactionId (camelCase)', () => {
      const payload = {
        transactionId: 'TXN-ABC-123',
        status: 'SUCCESS',
        amount: 2500,
      };

      const parsed = kkiapayProvider.parserWebhook(payload);

      expect(parsed.evenementId).toBe('TXN-ABC-123');
      expect(parsed.referencePrestataire).toBe('TXN-ABC-123');
      expect(parsed.statut).toBe(StatutPaiement.REUSSI);
      expect(parsed.montant).toBe(2500);
      expect(parsed.evenementId).not.toBe('undefined');
    });
  });

  describe('FedaPayProvider', () => {
    it('valide la signature FedaPay avec le format officiel t=...,s=...', () => {
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_123', entity: 'transaction' }));
      const timestamp = '1710000000';
      const sig = createHmac('sha256', 'test-fedapay-secret').update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');

      const valide = fedapayProvider.verifierSignature(rawBody, {
        'x-fedapay-signature': `t=${timestamp},s=${sig}`,
      });

      expect(valide).toBe(true);
    });

    it('rejette une signature FedaPay invalide', () => {
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_123' }));
      const valide = fedapayProvider.verifierSignature(rawBody, {
        'x-fedapay-signature': 't=1710000000,s=fake_signature',
      });

      expect(valide).toBe(false);
    });

    it('parse correctement la devise objet { iso: "XOF" } sans renvoyer [object Object]', () => {
      const payload = {
        id: 'evt_001',
        data: {
          id: 888,
          status: 'approved',
          amount: 5000,
          currency: { iso: 'XOF' },
        },
      };

      const parsed = fedapayProvider.parserWebhook(payload);

      expect(parsed.devise).toBe('XOF');
      expect(parsed.devise).not.toBe('[object Object]');
      expect(parsed.statut).toBe(StatutPaiement.REUSSI);
    });
  });

  describe('StripeProvider', () => {
    it('parse un webhook checkout.session.completed payé en EUR', () => {
      const payload = {
        id: 'evt_stripe_999',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            client_reference_id: 'EDK-REF-777',
            payment_status: 'paid',
            amount_total: 1500, // 15.00 EUR en centimes
            currency: 'eur',
            metadata: { reference: 'EDK-REF-777' },
          },
        },
      };

      const parsed = stripeProvider.parserWebhook(payload);

      expect(parsed.statut).toBe(StatutPaiement.REUSSI);
      expect(parsed.reference).toBe('EDK-REF-777');
      expect(parsed.referencePrestataire).toBe('cs_test_123');
      expect(parsed.montant).toBe(15); // Converti de centimes vers unités
      expect(parsed.devise).toBe('EUR');
    });

    it('gère correctement une devise zero-decimal comme le XOF sans diviser par 100', () => {
      const payload = {
        id: 'evt_stripe_888',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_456',
            payment_status: 'paid',
            amount_total: 2500, // 2500 XOF direct (zero-decimal)
            currency: 'xof',
            metadata: { reference: 'EDK-REF-888' },
          },
        },
      };

      const parsed = stripeProvider.parserWebhook(payload);

      expect(parsed.montant).toBe(2500);
      expect(parsed.devise).toBe('XOF');
    });

    it('parse un statut expiré sur checkout.session.expired', () => {
      const payload = {
        id: 'evt_stripe_777',
        type: 'checkout.session.expired',
        data: {
          object: {
            id: 'cs_test_expired',
            payment_status: 'unpaid',
            amount_total: 1000,
            currency: 'eur',
          },
        },
      };

      const parsed = stripeProvider.parserWebhook(payload);
      expect(parsed.statut).toBe(StatutPaiement.EXPIRE);
    });
  });
});
