import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { RevenueCatProvider } from './revenuecat.provider';
import { MethodePaiement, StatutPaiement } from '../shared/paiement.enums';

describe('RevenueCatProvider', () => {
  const config = { get: jest.fn() } as unknown as ConfigService;
  const provider = new RevenueCatProvider(config);

  it('parse un achat RevenueCat en paiement réussi IAP', () => {
    const parsed = provider.parserWebhook({
      api_version: '1.0',
      event: {
        id: 'evt_1',
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user-1',
        transaction_id: 'txn-1',
        price_in_purchased_currency: 4.99,
        currency: 'EUR',
      },
    });

    expect(parsed).toMatchObject({
      evenementId: 'evt_1',
      referencePrestataire: 'txn-1',
      reference: 'user-1',
      statut: StatutPaiement.REUSSI,
      montant: 4.99,
      devise: 'EUR',
      methode: MethodePaiement.IAP,
    });
  });

  it('valide la signature HMAC RevenueCat', () => {
    const raw = Buffer.from('{"event":{"id":"evt_1"}}');
    const timestamp = '1710000000';
    const signature = createHmac('sha256', 'secret').update(`${timestamp}.${raw.toString()}`).digest('hex');
    expect(provider.verifierSignature(raw, {
      'x-revenuecat-webhook-signature': `t=${timestamp},v1=${signature}`,
    }, { webhook_secret: 'secret' })).toBe(true);
  });
});
