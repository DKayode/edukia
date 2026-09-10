import { ParrainageService } from './parrainage.service';
import { RewardSourceTypeCode, WalletStatus } from '../wallet/shared/payment.enums';

const abonnement = (surcharges: any = {}) => ({
  id: 1,
  uuid: 'abo-1',
  utilisateur_id: 10,
  parrain_id: 20,
  montant_paye: 2000,
  commission_versee: false,
  plan: { code: 'MENSUEL' },
  ...surcharges,
});

describe('ParrainageService', () => {
  let abonnements: any, utilisateurs: any, dataSource: any, credit: any, service: ParrainageService;

  beforeEach(() => {
    abonnements = { update: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]) };
    utilisateurs = {
      findOne: jest.fn().mockResolvedValue({ id: 20, est_desactive: false }),
      find: jest.fn().mockResolvedValue([]),
    };
    // Aucun wallet trouvé = wallet à créer, pas un wallet bloqué.
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(),
    };
    credit = { execute: jest.fn().mockResolvedValue({ duplicated: false }) };
    // `moduleRef.get` remplace l'injection directe : le use-case est résolu
    // au moment de l'appel pour ne pas fermer un cycle de modules.
    service = new ParrainageService(abonnements, utilisateurs, dataSource, { get: () => credit } as any);
  });

  describe('versement', () => {
    it('crédite le parrain sur l’identifiant de l’ABONNEMENT', async () => {
      const r = await service.verserCommission(abonnement() as any);

      expect(r.verse).toBe(true);
      const commande = credit.execute.mock.calls[0][0];
      expect(commande).toMatchObject({
        userId: 20,
        sourceType: RewardSourceTypeCode.PARRAINAGE_ABONNEMENT,
        // Le piège de l'issue : avec l'id du filleul (10) ou du parrain (20),
        // la déduplication (wallet, sourceType, sourceId) du use-case avalerait
        // silencieusement le second parrainage.
        sourceId: 'abo-1',
        baseAmount: 2000,
      });
      expect(commande.sourceId).not.toBe('10');
      expect(commande.sourceId).not.toBe('20');
    });

    it('crédite DEUX fois un parrain pour deux filleuls différents', async () => {
      await service.verserCommission(abonnement({ id: 1, uuid: 'abo-1', utilisateur_id: 10 }) as any);
      await service.verserCommission(abonnement({ id: 2, uuid: 'abo-2', utilisateur_id: 11 }) as any);

      const ids = credit.execute.mock.calls.map((c: any[]) => c[0].sourceId);
      expect(ids).toEqual(['abo-1', 'abo-2']);
      expect(new Set(ids).size).toBe(2);
    });

    it('marque la commission comme versée', async () => {
      await service.verserCommission(abonnement() as any);
      expect(abonnements.update).toHaveBeenCalledWith(1, { commission_versee: true });
    });

    it('transmet le montant payé comme base du pourcentage', async () => {
      await service.verserCommission(abonnement({ montant_paye: 18000 }) as any);
      expect(credit.execute.mock.calls[0][0].baseAmount).toBe(18000);
    });
  });

  describe('refus', () => {
    it.each([
      ['sans parrain', { parrain_id: null }, 'AUCUN_PARRAIN'],
      ['commission déjà versée', { commission_versee: true }, 'DEJA_VERSEE'],
      ['auto-parrainage', { parrain_id: 10 }, 'AUTO_PARRAINAGE'],
    ])('refuse %s', async (_titre, surcharges, motif) => {
      const r = await service.verserCommission(abonnement(surcharges) as any);
      expect(r).toMatchObject({ verse: false, motif });
      expect(credit.execute).not.toHaveBeenCalled();
    });

    it('refuse un parrain désactivé', async () => {
      utilisateurs.findOne.mockResolvedValue({ id: 20, est_desactive: true });
      const r = await service.verserCommission(abonnement() as any);
      expect(r).toMatchObject({ verse: false, motif: 'PARRAIN_DESACTIVE' });
      expect(credit.execute).not.toHaveBeenCalled();
    });

    it('refuse un wallet bloqué — créditer produirait une ligne non retirable', async () => {
      dataSource.query.mockResolvedValue([{ status: WalletStatus.BLOCKED }]);
      const r = await service.verserCommission(abonnement() as any);
      expect(r).toMatchObject({ verse: false, motif: 'WALLET_INDISPONIBLE' });
    });

    it('n’échoue pas quand le wallet refuse le crédit', async () => {
      // Commission désactivée, taux à zéro, plafond atteint : le versement
      // échoue mais l'activation de l'abonnement, elle, doit tenir.
      credit.execute.mockRejectedValue(new Error('La récompense du type PARRAINAGE_ABONNEMENT est désactivée'));
      await expect(service.verserCommission(abonnement() as any)).resolves.toMatchObject({ verse: false });
      // Non marqué versé : l'abonnement reste rattrapable.
      expect(abonnements.update).not.toHaveBeenCalled();
    });

    it('reste rattrapable après un échec, puis réussit', async () => {
      credit.execute.mockRejectedValueOnce(new Error('wallet indisponible'));
      expect((await service.verserCommission(abonnement() as any)).verse).toBe(false);

      credit.execute.mockResolvedValue({ duplicated: false });
      expect((await service.verserCommission(abonnement() as any)).verse).toBe(true);
    });
  });

  describe('reprise après remboursement', () => {
    const commissionVersee = () => abonnement({ commission_versee: true });

    it('annule la commission et débite le solde disponible dans une transaction', async () => {
      const manager = {
        query: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{
            id: 'tx-credit',
            wallet_id: 'wallet-1',
            amount: '200',
            status: 'COMPLETED',
            available_balance: '500',
            pending_balance: '50',
          }])
          .mockResolvedValue([]),
      };
      dataSource.transaction.mockImplementation((callback: any) => callback(manager));

      const resultat = await service.reprendreCommission(commissionVersee() as any);

      expect(resultat).toEqual({ reprise: true, montant: 200 });
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE wallets'),
        ['wallet-1', 300, 50],
      );
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'CANCELLED'"),
        ['tx-credit'],
      );
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallet_transactions'),
        expect.arrayContaining([
          'wallet-1',
          -200,
          550,
          350,
          300,
          50,
          'PARRAINAGE_ABONNEMENT_REFUND:abo-1',
        ]),
      );
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE abonnements SET commission_versee = false'),
        [1],
      );
    });

    it('débite le solde en attente quand la commission attendait une validation', async () => {
      const manager = {
        query: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{
            id: 'tx-credit',
            wallet_id: 'wallet-1',
            amount: '200',
            status: 'PENDING',
            available_balance: '100',
            pending_balance: '250',
          }])
          .mockResolvedValue([]),
      };
      dataSource.transaction.mockImplementation((callback: any) => callback(manager));

      expect(await service.reprendreCommission(commissionVersee() as any)).toEqual({ reprise: true, montant: 200 });
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE wallets'),
        ['wallet-1', 100, 50],
      );
    });

    it('est idempotente quand la reprise existe déjà', async () => {
      const manager = {
        query: jest.fn()
          .mockResolvedValueOnce([{ amount: '200' }])
          .mockResolvedValueOnce([]),
      };
      dataSource.transaction.mockImplementation((callback: any) => callback(manager));

      const resultat = await service.reprendreCommission(commissionVersee() as any);

      expect(resultat).toEqual({ reprise: true, dupliquee: true, montant: 200 });
      expect(manager.query).toHaveBeenCalledTimes(2);
      expect(manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE wallets'),
        expect.anything(),
      );
    });

    it('ne touche pas au wallet si aucune commission n’avait été versée', async () => {
      expect(await service.reprendreCommission(abonnement() as any)).toEqual({
        reprise: false,
        motif: 'COMMISSION_NON_VERSEE',
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('laisse le remboursement réussir si le parrain a déjà dépensé la commission', async () => {
      const manager = {
        query: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{
            id: 'tx-credit',
            wallet_id: 'wallet-1',
            amount: '200',
            status: 'COMPLETED',
            available_balance: '100',
            pending_balance: '0',
          }]),
      };
      dataSource.transaction.mockImplementation((callback: any) => callback(manager));

      await expect(service.reprendreCommission(commissionVersee() as any)).resolves.toEqual({
        reprise: false,
        motif: 'SOLDE_INSUFFISANT',
      });
      expect(manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE wallets'),
        expect.anything(),
      );
    });
  });

  describe('résolution du bénéficiaire', () => {
    const proprietaireDuCode = (u: any) => utilisateurs.findOne.mockResolvedValue(u);

    it('crédite le propriétaire du code présenté', async () => {
      proprietaireDuCode({ id: 33 });
      expect(await service.resoudreParrain(10, 'CODE33')).toBe(33);
    });

    it('ne crédite PERSONNE sans code', async () => {
      // La commission récompense l'acte de vente, pas l'acquisition passée :
      // un parrain d'inscription seul n'ouvre aucun droit.
      expect(await service.resoudreParrain(10)).toBeNull();
      expect(await service.resoudreParrain(10, '')).toBeNull();
      expect(await service.resoudreParrain(10, '   ')).toBeNull();
      // Aucune requête : inutile d'aller chercher un parrain qui ne sera pas payé.
      expect(utilisateurs.findOne).not.toHaveBeenCalled();
    });

    it('ne consulte jamais la relation d’inscription', async () => {
      proprietaireDuCode({ id: 33 });
      await service.resoudreParrain(10, 'CODE33');
      // Une seule requête, sur le code — `utilisateurs.parrain_id` n'est ni lu
      // ni écrit par ce chemin.
      expect(utilisateurs.findOne).toHaveBeenCalledTimes(1);
      expect(utilisateurs.findOne.mock.calls[0][0].where.mon_code_parrainage).toBeDefined();
      expect(utilisateurs.save).toBeUndefined();
      expect(utilisateurs.update).toBeUndefined();
    });

    it('normalise le code en majuscules, comme à l’inscription', async () => {
      proprietaireDuCode({ id: 33 });
      await service.resoudreParrain(10, ' code33 ');
      expect(utilisateurs.findOne.mock.calls[0][0].where.mon_code_parrainage).toBe('CODE33');
    });

    it('ignore un code inconnu sans faire échouer la souscription', async () => {
      proprietaireDuCode(null);
      expect(await service.resoudreParrain(10, 'INEXISTANT')).toBeNull();
    });

    it('refuse l’auto-parrainage', async () => {
      proprietaireDuCode({ id: 10 });
      expect(await service.resoudreParrain(10, 'MONCODE')).toBeNull();
    });
  });
});
