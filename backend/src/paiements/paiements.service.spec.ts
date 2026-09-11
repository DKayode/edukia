import { ParrainageService } from '../abonnements/parrainage.service';
import { StatutAbonnement } from '../abonnements/entities/abonnement.entity';
import { PaiementsService } from './paiements.service';
import { ModePaiement, PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';

describe('PaiementsService - remboursement et commission', () => {
  let paiements: any;
  let configurations: any;
  let abonnements: any;
  let abonnementsService: any;
  let parrainageService: jest.Mocked<Pick<ParrainageService, 'reprendreCommission'>>;
  let service: PaiementsService;

  const paiement = (statut = StatutPaiement.REUSSI): any => ({
    id: 1,
    uuid: 'paiement-1',
    reference: 'EDK-1',
    statut,
    abonnement_id: 11,
    payload_confirmation: {},
  });

  beforeEach(() => {
    paiements = { save: jest.fn(async (valeur) => valeur) };
    configurations = { find: jest.fn() };
    abonnements = {
      findOne: jest.fn().mockResolvedValue({
        id: 11,
        uuid: 'abo-1',
        statut: StatutAbonnement.ACTIF,
        commission_versee: true,
      }),
      save: jest.fn(async (valeur) => valeur),
    };
    abonnementsService = { journaliser: jest.fn().mockResolvedValue(undefined) };
    parrainageService = {
      reprendreCommission: jest.fn().mockResolvedValue({ reprise: true, montant: 200 }),
    };
    service = new PaiementsService(
      paiements as any,
      {} as any,
      configurations as any,
      abonnements as any,
      {} as any,
      {} as any,
      abonnementsService as any,
      parrainageService as unknown as ParrainageService,
      {} as any,
      {} as any,
    );
  });

  it('expose uniquement les informations publiques des prestataires actifs du pays', async () => {
    configurations.find.mockResolvedValue([
      {
        pays: 'benin',
        prestataire: PrestatairePaiement.FEDAPAY,
        mode: ModePaiement.LIVE,
        devise: 'XOF',
        montant_min: 500,
        montant_max: 500000,
        credentials_chiffres: { secret_key: 'secret' },
        credentials_masquees: { secret_key: '****cret' },
      },
      {
        pays: 'benin',
        prestataire: PrestatairePaiement.CINETPAY,
        mode: ModePaiement.SANDBOX,
        devise: 'XOF',
        montant_min: null,
        montant_max: null,
      },
    ]);

    await expect(service.prestatairesDisponibles('benin')).resolves.toEqual({
      pays: 'benin',
      prestataires: [{
        pays: 'benin',
        prestataire: PrestatairePaiement.FEDAPAY,
        libelle: 'FedaPay',
        mode: ModePaiement.LIVE,
        devise: 'XOF',
        montant_min: 500,
        montant_max: 500000,
      }],
    });
    expect(configurations.find).toHaveBeenCalledWith({
      where: { pays: 'benin', est_actif: true },
      order: { prestataire: 'ASC' },
    });
  });

  it('renvoie une liste vide lorsqu’aucun prestataire n’est disponible', async () => {
    configurations.find.mockResolvedValue([]);

    await expect(service.prestatairesDisponibles('togo')).resolves.toEqual({
      pays: 'togo',
      prestataires: [],
    });
  });

  it('reprend la commission lorsqu’un paiement réussi est remboursé', async () => {
    const courant = paiement();
    jest.spyOn(service as any, 'paiementAdmin').mockResolvedValue(courant);

    await service.rembourser('benin', courant.uuid, { motif: 'demande client' });

    expect(courant.statut).toBe(StatutPaiement.REMBOURSE);
    expect(abonnements.save).toHaveBeenCalledWith(expect.objectContaining({ statut: StatutAbonnement.REMBOURSE }));
    expect(parrainageService.reprendreCommission).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'abo-1' }),
    );
    expect(courant.payload_confirmation.remboursement.reprise_commission).toEqual({
      reprise: true,
      montant: 200,
    });
  });

  it('conserve le remboursement même si la reprise manque de solde', async () => {
    const courant = paiement();
    parrainageService.reprendreCommission.mockResolvedValue({
      reprise: false,
      motif: 'SOLDE_INSUFFISANT',
    });
    jest.spyOn(service as any, 'paiementAdmin').mockResolvedValue(courant);

    await expect(service.rembourser('benin', courant.uuid, {})).resolves.toBe(courant);
    expect(courant.statut).toBe(StatutPaiement.REMBOURSE);
  });

  it('relance la reprise sur un paiement déjà remboursé sans rejouer le remboursement', async () => {
    const courant = paiement(StatutPaiement.REMBOURSE);
    abonnements.findOne.mockResolvedValue({
      id: 11,
      uuid: 'abo-1',
      statut: StatutAbonnement.REMBOURSE,
      commission_versee: true,
    });
    jest.spyOn(service as any, 'paiementAdmin').mockResolvedValue(courant);

    await service.rembourser('benin', courant.uuid, {});

    expect(parrainageService.reprendreCommission).toHaveBeenCalledTimes(1);
    expect(abonnements.save).not.toHaveBeenCalled();
    expect(abonnementsService.journaliser).not.toHaveBeenCalled();
  });
});
