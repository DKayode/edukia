import { AbonnementsService } from './abonnements.service';
import { TypeEvenementAbonnement } from './entities/abonnement-evenement.entity';
import { StatutAbonnement } from './entities/abonnement.entity';

describe('AbonnementsService - déclenchement de l’annonce', () => {
  let abonnements: any;
  let evenements: any;
  let annonces: any;
  let service: AbonnementsService;

  const ligne = (surcharge: Record<string, unknown> = {}): any => ({
    id: 1,
    uuid: 'abo-1',
    utilisateur_id: 7,
    statut: StatutAbonnement.ACTIF,
    date_fin: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    ...surcharge,
  });

  beforeEach(() => {
    abonnements = { findOne: jest.fn().mockResolvedValue(ligne()) };
    evenements = { save: jest.fn().mockResolvedValue({}), create: jest.fn((v) => v) };
    annonces = { annoncerActivation: jest.fn().mockResolvedValue(undefined) };

    service = new AbonnementsService(
      abonnements as any,
      evenements as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue(annonces) } as any,
    );
  });

  it('annonce une activation', async () => {
    await service.journaliser(1, TypeEvenementAbonnement.ACTIVE, {});
    expect(annonces.annoncerActivation).toHaveBeenCalledTimes(1);
  });

  it('reste muet sur les autres événements', async () => {
    for (const type of [
      TypeEvenementAbonnement.CREE,
      TypeEvenementAbonnement.PAYE,
      TypeEvenementAbonnement.EXPIRE,
      TypeEvenementAbonnement.ANNULE,
      TypeEvenementAbonnement.PROLONGE,
    ]) {
      await service.journaliser(1, type, {});
    }
    expect(annonces.annoncerActivation).not.toHaveBeenCalled();
  });

  it('ne promet pas un accès qu’une réactivation n’ouvre pas', async () => {
    // `reactiver()` journalise un ACTIVE même quand il repose l'abonnement en
    // EXPIRE, faute de période restante.
    abonnements.findOne.mockResolvedValue(ligne({ statut: StatutAbonnement.EXPIRE }));

    await service.journaliser(1, TypeEvenementAbonnement.ACTIVE, { reactivation: true });

    expect(annonces.annoncerActivation).not.toHaveBeenCalled();
  });

  it('ne dit rien d’un ACTIF dont la date est déjà passée', async () => {
    abonnements.findOne.mockResolvedValue(ligne({ date_fin: new Date(Date.now() - 1000) }));

    await service.journaliser(1, TypeEvenementAbonnement.ACTIVE, {});

    expect(annonces.annoncerActivation).not.toHaveBeenCalled();
  });

  it('laisse passer l’activation même si l’annonce échoue', async () => {
    annonces.annoncerActivation.mockRejectedValue(new Error('panne'));

    await expect(service.journaliser(1, TypeEvenementAbonnement.ACTIVE, {})).resolves.toBeUndefined();
  });

  it('enregistre l’événement même quand l’abonnement a disparu', async () => {
    abonnements.findOne.mockResolvedValue(null);

    await service.journaliser(1, TypeEvenementAbonnement.ACTIVE, {});

    expect(evenements.save).toHaveBeenCalledTimes(1);
    expect(annonces.annoncerActivation).not.toHaveBeenCalled();
  });
});
