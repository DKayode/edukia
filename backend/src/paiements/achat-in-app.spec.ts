import { PaiementsService } from './paiements.service';
import { MethodePaiement, PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';
import { StatutAbonnement } from '../abonnements/entities/abonnement.entity';

/**
 * Achats in-app (App Store / Play Store via RevenueCat).
 *
 * Contrairement au mobile money, rien n'est initié chez nous : le store
 * encaisse, puis RevenueCat notifie. Sans création du paiement à la réception,
 * la notification était jetée — « PAIEMENT_INTROUVABLE_IGNORE » — et
 * l'abonnement restait en attente alors que le store considérait la personne
 * comme abonnée. C'est le symptôme rapporté en production.
 */
describe('PaiementsService — achat in-app', () => {
  let paiements: any, webhooks: any, abonnements: any, utilisateurs: any, plans: any;
  let providers: any, service: PaiementsService;

  const UUID = '8d62ecbd-1010-4371-b62e-58607a56279d';

  const webhook = (surcharges: any = {}) => ({
    event: {
      id: 'evt-1', type: 'INITIAL_PURCHASE', product_id: 'com.edukia.app.premium.annuel',
      app_user_id: UUID, transaction_id: '2000001240925323', price: 29.99,
      currency: 'USD', environment: 'SANDBOX', store: 'APP_STORE',
      ...surcharges,
    },
  });

  const evenement = {
    evenementId: 'evt-1', reference: UUID, referencePrestataire: '2000001240925323',
    statut: StatutPaiement.REUSSI, montant: 29.99, devise: 'USD', methode: MethodePaiement.IAP,
  };

  const cree = () => paiements.create.mock.calls[0][0];

  beforeEach(() => {
    paiements = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 99, ...d })),
      save: jest.fn(async (d) => d),
    };
    webhooks = { update: jest.fn() };
    abonnements = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 5, uuid: 'abo-1', ...d })),
      save: jest.fn(async (d) => d),
    };
    utilisateurs = { findOne: jest.fn().mockResolvedValue({ id: 34663, uuid: UUID, pays: 'benin' }) };
    plans = { findOne: jest.fn().mockResolvedValue({ id: 3, code: 'ANNUEL', pays: 'benin', duree_jours: 365 }) };
    providers = { get: jest.fn(() => ({ parserWebhook: () => evenement })) };
    service = new PaiementsService(
      paiements, webhooks, {} as any, abonnements, utilisateurs, plans,
      providers, {} as any, {} as any, {} as any, {} as any, { get: () => undefined } as any,
    );
  });

  const traiter = (p = webhook()) =>
    (service as any).creerPaiementAchatInApp(evenement, p);

  describe('rattachement', () => {
    it('retrouve le compte par son uuid — c’est l’app_user_id', async () => {
      await traiter();
      expect(utilisateurs.findOne).toHaveBeenCalledWith({ where: { uuid: UUID } });
    });

    it('retrouve le plan par l’identifiant produit du store', async () => {
      await traiter();
      const where = plans.findOne.mock.calls[0][0].where;
      expect(where.pays).toBe('benin');
      // `identifiants_store` est un ArrayContains de TypeORM : la valeur
      // cherchée vit dans sa propriété `value`, pas dans sa représentation.
      expect((where.identifiants_store as any).value).toEqual(['com.edukia.app.premium.annuel']);
    });

    it('enregistre le montant et la devise DU STORE, pas le prix du plan', async () => {
      // Le store facture 29,99 USD là où le plan vaut 15 000 XOF. Forcer le prix
      // du plan ferait échouer le contrôle de montant, et mentirait sur ce qui
      // a été encaissé.
      await traiter();
      expect(cree()).toMatchObject({ montant: 29.99, devise: 'USD' });
    });

    it('prend le pays du COMPTE, pas celui de la boutique', async () => {
      // « country_code » décrit où l'achat a eu lieu, pas où la personne est
      // inscrite : un Béninois en voyage ne change pas de pays.
      await traiter(webhook({ country_code: 'FR' }));
      expect(cree().pays).toBe('benin');
    });

    it('classe en IAP, chez RevenueCat', async () => {
      await traiter();
      expect(cree()).toMatchObject({
        methode: MethodePaiement.IAP,
        prestataire: PrestatairePaiement.REVENUECAT,
      });
    });

    it('prend la transaction du store comme référence', async () => {
      // Elle est stable et unique, là où app_user_id se répète à chaque
      // renouvellement.
      await traiter();
      expect(cree().reference).toBe('2000001240925323');
    });
  });

  describe('mode', () => {
    it('reconnaît un achat de production', async () => {
      await traiter(webhook({ environment: 'PRODUCTION' }));
      expect(cree().mode).toBe('live');
    });

    it('reconnaît un achat de test', async () => {
      await traiter(webhook({ environment: 'SANDBOX' }));
      expect(cree().mode).toBe('sandbox');
    });
  });

  describe('abonnement', () => {
    it('réutilise la souscription en attente plutôt que d’en empiler une', async () => {
      // C'est celle que l'utilisateur voit déjà dans l'application.
      abonnements.findOne.mockResolvedValue({ id: 5, uuid: 'abo-existant' });
      await traiter();
      expect(abonnements.create).not.toHaveBeenCalled();
      expect(cree().abonnement_id).toBe(5);
    });

    it('en crée une si l’achat a eu lieu sans souscription préalable', async () => {
      await traiter();
      expect(abonnements.create).toHaveBeenCalledWith(
        expect.objectContaining({ utilisateur_id: 34663, plan_id: 3, statut: StatutAbonnement.EN_ATTENTE }),
      );
    });
  });

  describe('refus de deviner', () => {
    it('ignore un app_user_id inconnu', async () => {
      utilisateurs.findOne.mockResolvedValue(null);
      expect(await traiter()).toBeNull();
      expect(paiements.create).not.toHaveBeenCalled();
    });

    it('ignore un produit rattaché à aucun plan', async () => {
      // Plutôt que de choisir un plan au hasard : le journal dit quoi renseigner.
      plans.findOne.mockResolvedValue(null);
      expect(await traiter()).toBeNull();
      expect(paiements.create).not.toHaveBeenCalled();
    });

    it('ignore un webhook sans identifiant produit', async () => {
      plans.findOne.mockResolvedValue(null);
      expect(await traiter(webhook({ product_id: undefined }))).toBeNull();
    });
  });
});
