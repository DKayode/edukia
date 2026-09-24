import { PaiementsService } from './paiements.service';
import { PrestatairePaiement } from './shared/paiement.enums';

/**
 * Aiguillage RevenueCat : résiliation et expiration agissent sur l'abonnement,
 * pas sur un paiement, et ne doivent pas emprunter le chemin d'activation.
 */
describe('PaiementsService - cycle de vie RevenueCat', () => {
  let utilisateurs: any;
  let plans: any;
  let abonnementsService: any;
  let service: any;

  const construire = () => {
    const s = new PaiementsService(
      {} as any, {} as any, {} as any, {} as any,
      utilisateurs, plans, {} as any, abonnementsService,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return s;
  };

  beforeEach(() => {
    utilisateurs = { findOne: jest.fn().mockResolvedValue({ id: 7, uuid: 'u-7', pays: 'benin' }) };
    plans = { findOne: jest.fn().mockResolvedValue({ id: 3, code: 'MENSUEL' }) };
    abonnementsService = {
      desactiverRenouvellementStore: jest.fn().mockResolvedValue(undefined),
      expirerDepuisStore: jest.fn().mockResolvedValue(undefined),
    };
    service = construire();
  });

  const payload = (type: string) => ({
    event: { type, app_user_id: 'u-7', product_id: 'edukia_premium:mensuel' },
  });

  it('CANCELLATION coupe le renouvellement et est pris en charge', async () => {
    const traite = await (service as any).traiterCycleVieRevenueCat(payload('CANCELLATION'));
    expect(traite).toBe(true);
    expect(abonnementsService.desactiverRenouvellementStore).toHaveBeenCalledWith(7, 3);
    expect(abonnementsService.expirerDepuisStore).not.toHaveBeenCalled();
  });

  it('EXPIRATION expire l’abonnement', async () => {
    const traite = await (service as any).traiterCycleVieRevenueCat(payload('EXPIRATION'));
    expect(traite).toBe(true);
    expect(abonnementsService.expirerDepuisStore).toHaveBeenCalledWith(7, 3);
  });

  it('un achat n’est PAS un événement de cycle de vie', async () => {
    const traite = await (service as any).traiterCycleVieRevenueCat(payload('INITIAL_PURCHASE'));
    expect(traite).toBe(false);
    expect(abonnementsService.desactiverRenouvellementStore).not.toHaveBeenCalled();
    expect(abonnementsService.expirerDepuisStore).not.toHaveBeenCalled();
  });

  it('compte inconnu : pris en charge sans action, pour ne pas retomber sur l’activation', async () => {
    utilisateurs.findOne.mockResolvedValue(null);
    const traite = await (service as any).traiterCycleVieRevenueCat(payload('CANCELLATION'));
    expect(traite).toBe(true);
    expect(abonnementsService.desactiverRenouvellementStore).not.toHaveBeenCalled();
  });

  it('lit l’échéance et le renouvellement du payload store pour l’activation', () => {
    const paiement: any = {
      prestataire: PrestatairePaiement.REVENUECAT,
      payload_initiation: { event: { type: 'INITIAL_PURCHASE', expiration_at_ms: 1793000000000 } },
    };
    const data = (service as any).donneesStoreRevenueCat(paiement);
    expect(data.dateFin.getTime()).toBe(1793000000000);
    expect(data.renouvellementAuto).toBe(true);
  });

  it('un achat non renouvelable ne se reconduit pas', () => {
    const paiement: any = {
      prestataire: PrestatairePaiement.REVENUECAT,
      payload_initiation: { event: { type: 'NON_RENEWING_PURCHASE', expiration_at_ms: 1793000000000 } },
    };
    expect((service as any).donneesStoreRevenueCat(paiement).renouvellementAuto).toBe(false);
  });

  it('ne renvoie rien pour un prestataire qui n’est pas RevenueCat', () => {
    const paiement: any = { prestataire: PrestatairePaiement.STRIPE, payload_initiation: {} };
    expect((service as any).donneesStoreRevenueCat(paiement)).toBeNull();
  });
});
