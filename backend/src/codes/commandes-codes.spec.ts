import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CommandesCodesService } from './commandes-codes.service';
import { StatutCommande } from './entities/commande-code.entity';

describe('CommandesCodesService', () => {
  let commandes: any, plans: any, utilisateurs: any, codes: any, dataSource: any, mail: any;
  let service: CommandesCodesService;

  const PLAN = { id: 3, uuid: 'p-1', code: 'ANNUEL', libelle: 'Annuel', prix: 15000, devise: 'XOF', est_actif: true, pays: 'benin' };

  const commandeStub = (s: any = {}) => ({
    id: 1, uuid: 'c-1', pays: 'benin', utilisateur_id: 7, plan_id: 3,
    quantite: 3, prix_unitaire: 15000, montant_total: 45000, devise: 'XOF',
    statut: StatutCommande.EN_ATTENTE, plan: PLAN, ...s,
  });

  beforeEach(() => {
    commandes = {
      findOne: jest.fn().mockResolvedValue(commandeStub()),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d) => ({ id: 1, uuid: 'c-1', ...d })),
      save: jest.fn(async (d) => d),
      update: jest.fn(),
    };
    plans = { findOne: jest.fn().mockResolvedValue(PLAN) };
    utilisateurs = { findOne: jest.fn().mockResolvedValue({ id: 7, email: 'a@b.c', prenom: 'Awa' }) };
    codes = { count: jest.fn().mockResolvedValue(0) };
    // Rend autant de codes que de lignes demandées dans l'INSERT.
    dataSource = {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (!sql.includes('INSERT INTO codes')) return [];
        const n = (sql.match(/'ACHAT'/g) || []).length;
        return Array.from({ length: n }, (_, i) => ({ id: i + 1, code: `EDK-TEST${i}` }));
      }),
    };
    mail = { sendPersonalizedEmail: jest.fn().mockResolvedValue(undefined) };
    service = new CommandesCodesService(commandes, plans, utilisateurs, codes, dataSource, mail);
  });

  describe('création', () => {
    it('fige le prix unitaire et calcule le total', async () => {
      // Le tarif peut changer avant le paiement : l'acheteur doit payer ce
      // qu'on lui a annoncé.
      await service.creer('benin', 7, { plan_uuid: 'p-1', quantite: 3 });
      expect(commandes.save).toHaveBeenCalledWith(
        expect.objectContaining({ prix_unitaire: 15000, montant_total: 45000, quantite: 3 }),
      );
    });

    it('ne crée AUCUN code à ce stade', async () => {
      // Un panier abandonné laisserait des abonnements gratuits dans la nature.
      await service.creer('benin', 7, { plan_uuid: 'p-1', quantite: 3 });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('refuse une quantité nulle ou négative', async () => {
      for (const q of [0, -1, 1.5]) {
        await expect(service.creer('benin', 7, { plan_uuid: 'p-1', quantite: q }))
          .rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('refuse au-delà du plafond', async () => {
      await expect(service.creer('benin', 7, { plan_uuid: 'p-1', quantite: 501 }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un plan fermé à la vente', async () => {
      plans.findOne.mockResolvedValue({ ...PLAN, est_actif: false });
      await expect(service.creer('benin', 7, { plan_uuid: 'p-1', quantite: 1 }))
        .rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('accès', () => {
    it('cache la commande d’autrui derrière un « introuvable »', async () => {
      // Ne pas révéler qu'elle existe.
      await expect(service.parUuid('c-1', 999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('livraison', () => {
    it('engendre autant de codes que payés, et marque la commande', async () => {
      const n = await service.honorerCommande(1, 42);
      expect(n).toBe(3);
      expect(commandes.save).toHaveBeenCalledWith(
        expect.objectContaining({ statut: StatutCommande.PAYEE, paiement_id: 42 }),
      );
    });

    it('pose l’effet ABONNEMENT_OFFERT sur chaque code', async () => {
      await service.honorerCommande(1, 42);
      const effets = dataSource.query.mock.calls.find((c: any[]) => c[0].includes('code_effets'));
      expect(effets[0]).toContain('INSERT INTO code_effets');
      expect(effets[1]).toContain('ABONNEMENT_OFFERT');
    });

    it('crée des codes à usage unique appartenant à l’acheteur', async () => {
      await service.honorerCommande(1, 42);
      const insert = dataSource.query.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO codes'));
      // usage_max_total = 1 et usage_max_par_utilisateur = 1
      expect(insert[0]).toContain("'ACHAT'");
      expect(insert[0]).toMatch(/1, 1/);
      expect(insert[1]).toContain(7);
    });

    it('envoie les codes par courriel', async () => {
      await service.honorerCommande(1, 42);
      expect(mail.sendPersonalizedEmail).toHaveBeenCalled();
      const [destinataire, sujet, corps] = mail.sendPersonalizedEmail.mock.calls[0];
      expect(destinataire).toBe('a@b.c');
      expect(sujet).toContain('3 codes');
      expect(corps).toContain('EDK-TEST0');
    });

    it('est IDEMPOTENT — un webhook rejoué ne double pas la livraison', async () => {
      // Les prestataires rejouent leurs notifications.
      commandes.findOne.mockResolvedValue(commandeStub({ statut: StatutCommande.PAYEE }));
      expect(await service.honorerCommande(1, 42)).toBe(0);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('conserve la commande honorée même si le courriel échoue', async () => {
      // Un serveur de courriel indisponible ne doit pas faire perdre des codes
      // déjà payés : ils restent consultables dans l'application.
      mail.sendPersonalizedEmail.mockRejectedValue(new Error('SMTP down'));
      expect(await service.honorerCommande(1, 42)).toBe(3);
      expect(commandes.save).toHaveBeenCalledWith(
        expect.objectContaining({ statut: StatutCommande.PAYEE }),
      );
    });

    it('ignore une commande introuvable sans lever', async () => {
      commandes.findOne.mockResolvedValue(null);
      expect(await service.honorerCommande(999, 42)).toBe(0);
    });
  });
});
