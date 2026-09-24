import { AbonnementsService } from './abonnements.service';
import { StatutAbonnement } from './entities/abonnement.entity';
import { TypeEvenementAbonnement } from './entities/abonnement-evenement.entity';

/**
 * Cycle de vie in-app : une résiliation coupe le renouvellement sans révoquer
 * l'accès ; une expiration coupe l'accès.
 */
describe('AbonnementsService - cycle de vie store', () => {
  let abonnements: any;
  let evenements: any;
  let service: AbonnementsService;

  const actif = (surcharge = {}): any => ({
    id: 1, uuid: 'abo-1', utilisateur_id: 7, plan_id: 3,
    statut: StatutAbonnement.ACTIF, renouvellement_auto: true,
    date_fin: new Date('2026-10-24T00:00:00Z'), ...surcharge,
  });

  beforeEach(() => {
    abonnements = { findOne: jest.fn().mockResolvedValue(actif()), save: jest.fn(async (v) => v) };
    evenements = { save: jest.fn().mockResolvedValue({}), create: jest.fn((v) => v) };
    // Annonce d'activation résolue paresseusement : un stub inerte suffit.
    const moduleRef = { get: jest.fn().mockReturnValue({ annoncerActivation: jest.fn() }) };
    service = new AbonnementsService(
      abonnements, evenements, {} as any, {} as any, {} as any, {} as any, moduleRef as any,
    );
  });

  it('résiliation : garde ACTIF, coupe le renouvellement', async () => {
    await service.desactiverRenouvellementStore(7, 3);
    const sauve = abonnements.save.mock.calls[0][0];
    expect(sauve.statut).toBe(StatutAbonnement.ACTIF);
    expect(sauve.renouvellement_auto).toBe(false);
    expect(evenements.save).toHaveBeenCalled();
  });

  it('résiliation : ne rejournalise pas si le renouvellement est déjà coupé', async () => {
    abonnements.findOne.mockResolvedValue(actif({ renouvellement_auto: false }));
    await service.desactiverRenouvellementStore(7, 3);
    expect(abonnements.save).not.toHaveBeenCalled();
  });

  it('expiration : passe EXPIRE', async () => {
    await service.expirerDepuisStore(7, 3);
    const sauve = abonnements.save.mock.calls[0][0];
    expect(sauve.statut).toBe(StatutAbonnement.EXPIRE);
    expect(sauve.renouvellement_auto).toBe(false);
    expect(evenements.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: TypeEvenementAbonnement.EXPIRE }),
    );
  });

  it('n’agit pas quand aucun abonnement actif ne correspond', async () => {
    abonnements.findOne.mockResolvedValue(null);
    await service.desactiverRenouvellementStore(7, 3);
    await service.expirerDepuisStore(7, 3);
    expect(abonnements.save).not.toHaveBeenCalled();
  });
});
