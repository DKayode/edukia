import { ConflictException } from '@nestjs/common';
import { StatutCommande } from '../codes/entities/commande-code.entity';
import { PaiementsService } from './paiements.service';
import { convertirMontant } from './shared/conversion-devise';
import { ModePaiement, PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';

describe('convertirMontant', () => {
  it('convertit un prix XOF en EUR à la parité fixe, arrondi au centime', () => {
    expect(convertirMontant(1_050_000, 'XOF', 'EUR')).toBe(1600.71);
    expect(convertirMontant(15_000, 'XOF', 'EUR')).toBe(22.87);
  });

  it('laisse le montant intact quand les devises coïncident', () => {
    expect(convertirMontant(15_000, 'xof', 'XOF')).toBe(15_000);
  });

  it('convertit EUR vers XOF sans décimales', () => {
    expect(convertirMontant(10, 'EUR', 'XOF')).toBe(6560);
  });

  it('refuse une paire sans parité fixe', () => {
    expect(() => convertirMontant(10, 'XOF', 'USD')).toThrow(ConflictException);
  });
});

describe('PaiementsService - devise du prestataire et réconciliation', () => {
  let paiements: any;
  let provider: { initier: jest.Mock; verifierStatut: jest.Mock };
  let commandes: any;
  let service: PaiementsService;

  const configStripe = {
    pays: 'benin',
    prestataire: PrestatairePaiement.STRIPE,
    mode: ModePaiement.LIVE,
    devise: 'EUR',
    montant_min: null,
    montant_max: null,
    credentials_chiffres: {},
  };

  beforeEach(() => {
    paiements = {
      save: jest.fn(async (valeur) => valeur),
      create: jest.fn((valeur) => ({ uuid: 'paiement-1', ...valeur })),
      find: jest.fn(),
    };
    provider = {
      initier: jest.fn().mockResolvedValue({ referencePrestataire: 'cs_live_1', urlPaiement: 'https://checkout', payload: {} }),
      verifierStatut: jest.fn(),
    };
    commandes = {
      parUuid: jest.fn().mockResolvedValue({
        id: 7, uuid: 'commande-7', statut: StatutCommande.EN_ATTENTE, montant_total: 1_050_000, devise: 'XOF',
      }),
      lierPaiement: jest.fn(),
      honorerCommande: jest.fn(),
    };
    service = new PaiementsService(
      paiements,
      {} as any,
      { findOne: jest.fn().mockResolvedValue(configStripe), find: jest.fn().mockResolvedValue([configStripe]) } as any,
      {} as any,
      { findOne: jest.fn().mockResolvedValue({ id: 34940, email: 'client@example.com' }) } as any,
      {} as any,
      { get: jest.fn(() => provider) } as any,
      {} as any,
      {} as any,
      { decrypt: jest.fn(() => ({})) } as any,
      {} as any,
      commandes,
      { get: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'configurationPourPaiement').mockResolvedValue(configStripe);
  });

  it('facture une commande en XOF au montant converti dans la devise Stripe', async () => {
    const paiement = await service.initier('benin', 34940, {
      commande_uuid: 'commande-7',
      prestataire: PrestatairePaiement.STRIPE,
    } as any);

    expect(provider.initier).toHaveBeenCalledWith(expect.objectContaining({ montant: 1600.71, devise: 'EUR' }));
    expect(paiement).toEqual(expect.objectContaining({ montant: 1600.71, devise: 'EUR' }));
  });

  const enAttente = (expireIlYa: number): any => ({
    id: 78,
    uuid: 'paiement-78',
    prestataire: PrestatairePaiement.FEDAPAY,
    mode: ModePaiement.LIVE,
    statut: StatutPaiement.EN_ATTENTE,
    montant: 15_000,
    abonnement_id: 35,
    reference_prestataire: '113360913',
    date_expiration: new Date(Date.now() - expireIlYa),
  });

  it('confirme un paiement réglé juste avant l’échéance au lieu de l’expirer', async () => {
    const paiement = enAttente(60_000);
    paiements.find.mockResolvedValue([paiement]);
    provider.verifierStatut.mockResolvedValue({ statut: StatutPaiement.REUSSI, montant: 15_000 });
    const activer = jest.spyOn(service as any, 'activerAbonnementPaye').mockResolvedValue(undefined);

    await service.reconcilierPaiements();

    expect(paiement.statut).toBe(StatutPaiement.REUSSI);
    expect(activer).toHaveBeenCalledWith(paiement);
  });

  it('expire un paiement échu que le prestataire voit toujours en attente', async () => {
    const paiement = enAttente(60_000);
    paiements.find.mockResolvedValue([paiement]);
    provider.verifierStatut.mockResolvedValue({ statut: StatutPaiement.EN_ATTENTE, montant: 15_000 });

    await service.reconcilierPaiements();

    expect(paiement.statut).toBe(StatutPaiement.EXPIRE);
  });

  it('n’expire pas à l’aveugle quand le prestataire ne répond pas', async () => {
    const paiement = enAttente(60_000);
    paiements.find.mockResolvedValue([paiement]);
    provider.verifierStatut.mockRejectedValue(new Error('timeout'));

    await service.reconcilierPaiements();

    expect(paiement.statut).toBe(StatutPaiement.EN_ATTENTE);
  });

  it('expire directement un paiement échu sans référence prestataire', async () => {
    const paiement = { ...enAttente(60_000), reference_prestataire: null };
    paiements.find.mockResolvedValue([paiement]);

    await service.reconcilierPaiements();

    expect(provider.verifierStatut).not.toHaveBeenCalled();
    expect(paiement.statut).toBe(StatutPaiement.EXPIRE);
  });
});
