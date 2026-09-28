import { PaiementsService } from './paiements.service';
import { PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';

describe('PaiementsService - suivi des paiements par utilisateur', () => {
  let paiements: any;
  let service: PaiementsService;
  let getMany: jest.Mock;

  beforeEach(() => {
    getMany = jest.fn().mockResolvedValue([
      { uuid: 'p-2', utilisateur_id: 7, statut: StatutPaiement.REUSSI, montant: 15000, devise: 'XOF', prestataire: PrestatairePaiement.FEDAPAY },
      { uuid: 'p-1', utilisateur_id: 7, statut: StatutPaiement.EXPIRE, montant: 15000, devise: 'XOF', prestataire: PrestatairePaiement.FEDAPAY },
      { uuid: 'p-3', utilisateur_id: 9, statut: StatutPaiement.EXPIRE, montant: 1600.71, devise: 'EUR', prestataire: PrestatairePaiement.STRIPE },
    ]);
    const qb: any = {};
    for (const m of ['where', 'andWhere', 'select', 'orderBy']) qb[m] = jest.fn(() => qb);
    qb.getMany = getMany;
    paiements = {
      query: jest.fn()
        .mockResolvedValueOnce([{ utilisateurs: 3, aboutis: 1, non_aboutis: 2, tentatives: 4 }])
        .mockResolvedValueOnce([{ devise: 'XOF', montant: 15000 }])
        .mockResolvedValueOnce([
          { utilisateur_id: 7, uuid: 'u-7', email: 'a@b.c', tentatives: 2, reussies: 1, dernier_statut: 'REUSSI', total: 2 },
          { utilisateur_id: 9, uuid: 'u-9', email: 'd@e.f', tentatives: 1, reussies: 0, dernier_statut: 'EXPIRE', total: 2 },
        ]),
      createQueryBuilder: jest.fn(() => qb),
    };
    service = new PaiementsService(
      paiements, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, { get: jest.fn() } as any,
    );
  });

  it('classe chaque utilisateur, rattache ses tentatives et totalise ce qu’il a payé', async () => {
    const r = await service.adminSuivi('benin', { page: 1, limit: 20, issue: undefined } as any);

    expect(r.resume).toEqual(expect.objectContaining({ utilisateurs: 3, aboutis: 1, taux_conversion: 33.3 }));
    expect(r.total).toBe(2);
    expect(r.data[0]).toEqual(expect.objectContaining({
      issue: 'ABOUTI',
      montant_paye: [{ devise: 'XOF', montant: 15000 }],
    }));
    expect(r.data[0].paiements.map((p: any) => p.uuid)).toEqual(['p-2', 'p-1']);
    expect(r.data[1]).toEqual(expect.objectContaining({ issue: 'NON_ABOUTI', montant_paye: [] }));
  });

  it('transmet le filtre d’issue et la recherche à la requête', async () => {
    await service.adminSuivi('benin', { page: 2, limit: 10, issue: 'NON_ABOUTI', search: 'alexis' } as any);

    expect(paiements.query.mock.calls[2][1]).toEqual(['benin', null, null, 'NON_ABOUTI', '%alexis%', 10, 10]);
  });

  it('n’interroge pas le détail quand la page est vide', async () => {
    paiements.query.mockReset()
      .mockResolvedValueOnce([{ utilisateurs: 0, aboutis: 0, non_aboutis: 0, tentatives: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const r = await service.adminSuivi('benin', {} as any);

    expect(getMany).not.toHaveBeenCalled();
    expect(r).toEqual(expect.objectContaining({ data: [], total: 0, totalPages: 0 }));
    expect(r.resume.taux_conversion).toBe(0);
  });
});
