import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StatutAbonnement } from '../abonnements/entities/abonnement.entity';
import { PaiementsService } from './paiements.service';
import { ModePaiement, PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';

describe('PaiementsService - vérification à la demande', () => {
  let paiements: any;
  let abonnements: any;
  let abonnementsService: any;
  let commandes: any;
  let provider: any;
  let registre: any;
  let service: PaiementsService;

  const ligne = (surcharge: Partial<Record<string, unknown>> = {}): any => ({
    id: 1,
    uuid: 'paiement-1',
    pays: 'benin',
    utilisateur_id: 7,
    statut: StatutPaiement.EN_ATTENTE,
    montant: 15000,
    devise: 'XOF',
    prestataire: PrestatairePaiement.STRIPE,
    mode: ModePaiement.SANDBOX,
    reference_prestataire: 'cs_test_1',
    abonnement_id: 11,
    commande_id: null,
    payload_confirmation: null,
    date_confirmation: null,
    ...surcharge,
  });

  beforeEach(() => {
    paiements = {
      findOne: jest.fn(),
      save: jest.fn(async (v) => v),
    };
    abonnements = {
      findOne: jest.fn().mockResolvedValue({
        id: 11,
        uuid: 'abo-1',
        statut: StatutAbonnement.ACTIF,
        date_debut: new Date('2026-09-01'),
        date_fin: new Date('2026-10-01'),
      }),
      update: jest.fn(),
    };
    abonnementsService = { journaliser: jest.fn().mockResolvedValue(undefined) };
    commandes = { parId: jest.fn().mockResolvedValue(null), honorerCommande: jest.fn() };
    provider = { verifierStatut: jest.fn() };
    registre = { get: jest.fn().mockReturnValue(provider) };

    service = new PaiementsService(
      paiements as any,
      {} as any,
      { findOne: jest.fn().mockResolvedValue({ credentials_chiffres: { secret_key: 's' } }) } as any,
      abonnements as any,
      {} as any,
      { findOne: jest.fn() } as any,
      registre as any,
      abonnementsService as any,
      {} as any,
      { decrypt: jest.fn((v) => v) } as any,
      {} as any,
      commandes as any,
      { get: jest.fn() } as any,
    );
    // L'activation appartient au service des abonnements ; on l'isole ici.
    (service as any).activerAbonnementPaye = jest.fn().mockResolvedValue(undefined);
  });

  it('interroge le prestataire et renvoie l’abonnement débloqué', async () => {
    paiements.findOne.mockImplementation(async () =>
      provider.verifierStatut.mock.calls.length === 0
        ? ligne()
        : ligne({ statut: StatutPaiement.REUSSI, date_confirmation: new Date('2026-09-24T07:22:00Z') }),
    );
    provider.verifierStatut.mockResolvedValue({
      statut: StatutPaiement.REUSSI,
      montant: 15000,
      devise: 'XOF',
    });

    const etat = await service.verifierMaintenant('benin', 7, 'paiement-1');

    expect(provider.verifierStatut).toHaveBeenCalledWith('cs_test_1', { secret_key: 's' }, ModePaiement.SANDBOX);
    expect((service as any).activerAbonnementPaye).toHaveBeenCalled();
    expect(etat.paiement.statut).toBe(StatutPaiement.REUSSI);
    expect(etat.abonnement).toMatchObject({ uuid: 'abo-1', statut: StatutAbonnement.ACTIF });
  });

  it('ne rappelle pas le prestataire quand le paiement est déjà dans un statut final', async () => {
    paiements.findOne.mockResolvedValue(ligne({ statut: StatutPaiement.REUSSI }));

    const etat = await service.verifierMaintenant('benin', 7, 'paiement-1');

    expect(provider.verifierStatut).not.toHaveBeenCalled();
    expect(etat.paiement.statut).toBe(StatutPaiement.REUSSI);
  });

  it('refuse explicitement un paiement jamais transmis au prestataire', async () => {
    paiements.findOne.mockResolvedValue(
      ligne({ statut: StatutPaiement.INITIE, reference_prestataire: null }),
    );

    await expect(service.verifierMaintenant('benin', 7, 'paiement-1')).rejects.toBeInstanceOf(ConflictException);
    expect(provider.verifierStatut).not.toHaveBeenCalled();
  });

  it('ne transforme pas une panne du prestataire en échec du paiement', async () => {
    paiements.findOne.mockResolvedValue(ligne());
    provider.verifierStatut.mockRejectedValue(new Error('ECONNRESET'));

    await expect(service.verifierMaintenant('benin', 7, 'paiement-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(paiements.save).not.toHaveBeenCalled();
  });

  it('ne laisse pas lire le paiement d’un autre compte', async () => {
    paiements.findOne.mockResolvedValue(null);

    await expect(service.verifierMaintenant('benin', 99, 'paiement-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remonte la commande de codes plutôt que l’abonnement quand le paiement en porte une', async () => {
    paiements.findOne.mockResolvedValue(
      ligne({ statut: StatutPaiement.REUSSI, abonnement_id: null, commande_id: 5 }),
    );
    commandes.parId.mockResolvedValue({ uuid: 'cmd-1', statut: 'PAYEE', quantite: 3 });

    const etat = await service.verifierMaintenant('benin', 7, 'paiement-1');

    expect(etat.abonnement).toBeNull();
    expect(etat.commande).toMatchObject({ uuid: 'cmd-1', statut: 'PAYEE', quantite: 3 });
  });
});
