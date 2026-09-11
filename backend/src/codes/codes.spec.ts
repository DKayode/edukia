import { BadRequestException } from '@nestjs/common';
import { CodeValidationService } from './code-validation.service';
import { Effet, TypeRemise } from './entities/code-effet.entity';

const reduction = (valeur = 20, type = TypeRemise.POURCENTAGE) => ({
  effet: Effet.REDUCTION, parametres: { type, valeur },
});
const commission = (taux?: number) => ({ effet: Effet.COMMISSION, parametres: taux ? { taux } : null });
const offert = (duree_jours?: number) => ({
  effet: Effet.ABONNEMENT_OFFERT, parametres: duree_jours ? { duree_jours } : null,
});

const codeBase = (surcharges: any = {}) => ({
  id: 1,
  uuid: 'c-1',
  pays: 'benin',
  code: 'RENTREE2026',
  origine: 'ADMIN',
  proprietaire_id: null,
  libelle: 'Rentrée',
  effets: [reduction()],
  usage_max_total: null,
  usage_max_par_utilisateur: 1,
  usage_actuel: 0,
  date_debut: null,
  date_fin: null,
  plans_eligibles: null,
  est_actif: true,
  ...surcharges,
});

describe('CodeValidationService', () => {
  let codes: any, utilisations: any, service: CodeValidationService;
  let journal: Array<{ code_id: number; utilisateur_id: number }>;

  const brancher = (code: any | null) => {
    codes.createQueryBuilder = jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(code),
    }));
  };

  /** Compte les utilisations depuis le journal, comme le fait le vrai SQL. */
  const requeteJournal = async (sql: string, valeurs: any[]) => {
    if (!sql.includes('COUNT(*)')) return [];
    const [codeId, userId] = valeurs;
    const n = journal.filter(
      (l) => l.code_id === codeId && (userId === undefined || l.utilisateur_id === userId),
    ).length;
    return [{ n }];
  };

  beforeEach(() => {
    journal = [];
    codes = { query: jest.fn(requeteJournal) };
    utilisations = { query: jest.fn(requeteJournal), find: jest.fn().mockResolvedValue([]), delete: jest.fn() };
    service = new CodeValidationService(codes as any, utilisations as any);
  });

  describe('normalisation', () => {
    it.each([['  promo2026  ', 'PROMO2026'], ['Promo2026', 'PROMO2026']])(
      'normalise « %s » en %s',
      (entree, attendu) => {
        // La casse ne doit jamais départager deux codes : sans cela,
        // `promo2026` et `PROMO2026` deviendraient deux codes distincts.
        expect(CodeValidationService.normaliser(entree)).toBe(attendu);
      },
    );
  });

  describe('calcul de la remise', () => {
    it('applique un pourcentage, arrondi à l’entier', () => {
      const r = service.calculerRemise({ type: TypeRemise.POURCENTAGE, valeur: 15 }, 999);
      expect(r).toMatchObject({ montant_remise: 150, prix_final: 849 });
      expect(Number.isInteger(r.montant_remise)).toBe(true);
    });

    it('applique un montant fixe', () => {
      expect(service.calculerRemise({ type: TypeRemise.MONTANT_FIXE, valeur: 500 }, 2000))
        .toMatchObject({ montant_remise: 500, prix_final: 1500 });
    });

    it('plafonne au prix — pas de prix négatif', () => {
      // Un code « −5000 » sur un plan à 2000 rend l'abonnement gratuit ; il ne
      // crée pas une créance envers l'utilisateur.
      expect(service.calculerRemise({ type: TypeRemise.MONTANT_FIXE, valeur: 5000 }, 2000))
        .toMatchObject({ montant_remise: 2000, prix_final: 0 });
    });

    it('rend une remise de 100 % gratuite, pas négative', () => {
      expect(service.calculerRemise({ type: TypeRemise.POURCENTAGE, valeur: 100 }, 2000))
        .toMatchObject({ montant_remise: 2000, prix_final: 0 });
    });
  });

  describe('composition des effets', () => {
    it('cumule remise et commission — l’ancien « ambassadeur »', async () => {
      brancher(codeBase({ effets: [reduction(10), commission()], proprietaire_id: 20 }));
      const r = await service.valider('X', 10, { prix: 2000 });
      expect(r.effets).toMatchObject({ commission_pour: 20 });
      expect(r.effets!.remise).toMatchObject({ montant_remise: 200 });
      // La composition remplace une valeur d'énumération : aucun « type » à nommer.
      expect(r.code!.effets).toEqual([Effet.REDUCTION, Effet.COMMISSION]);
    });

    it('n’attribue aucune commission sans propriétaire', async () => {
      brancher(codeBase({ effets: [commission()], proprietaire_id: null }));
      expect((await service.valider('X', 10)).effets?.commission_pour).toBeUndefined();
    });

    it('rend un abonnement offert, avec sa durée', async () => {
      brancher(codeBase({ effets: [offert(90)] }));
      expect((await service.valider('X', 10, { prix: 2000 })).effets)
        .toMatchObject({ abonnement_offert: { duree_jours: 90 } });
    });

    it('laisse la durée au plan quand elle n’est pas précisée', async () => {
      brancher(codeBase({ effets: [offert()] }));
      const e = (await service.valider('X', 10)).effets!;
      expect(e.abonnement_offert).toBeDefined();
      expect(e.abonnement_offert!.duree_jours).toBeUndefined();
    });

    it('un code sans effet est valide mais ne produit rien', async () => {
      // Un code de suivi pur, par exemple : il se consomme, sans conséquence.
      brancher(codeBase({ effets: [] }));
      const r = await service.valider('X', 10, { prix: 2000 });
      expect(r.valide).toBe(true);
      expect(r.effets).toEqual({});
    });
  });

  describe('validation sans compte', () => {
    // La route est ouverte : un code se saisit souvent avant l'inscription.

    it('valide un code et calcule la remise pour un visiteur anonyme', async () => {
      brancher(codeBase());
      const r = await service.valider('rentree2026', undefined, { prix: 2000 });
      expect(r.valide).toBe(true);
      expect(r.effets!.remise).toMatchObject({ montant_remise: 400, prix_final: 1600 });
    });

    it('applique les refus qui ne dépendent pas du compte', async () => {
      for (const [cas, motif] of [
        [{ est_actif: false }, 'INACTIF'],
        [{ date_fin: new Date(Date.now() - 86400000) }, 'EXPIRE'],
        [{ plans_eligibles: [7, 8] }, 'PLAN_NON_ELIGIBLE'],
      ] as const) {
        brancher(codeBase(cas as any));
        expect(await service.valider('X', undefined, { planId: 1 })).toMatchObject({ motif });
      }
    });

    it('applique le quota TOTAL, qui ne dépend d’aucun compte', async () => {
      brancher(codeBase({ usage_max_total: 2 }));
      journal = [
        { code_id: 1, utilisateur_id: 55 },
        { code_id: 1, utilisateur_id: 56 },
      ];
      expect(await service.valider('X', undefined)).toMatchObject({ motif: 'QUOTA_TOTAL_ATTEINT' });
    });

    it('ne peut pas détecter l’usage de son propre code', async () => {
      // Indécidable sans savoir qui appelle. La souscription, elle, exige un
      // compte et refusera.
      brancher(codeBase({ proprietaire_id: 10 }));
      expect((await service.valider('X', undefined)).valide).toBe(true);
      brancher(codeBase({ proprietaire_id: 10 }));
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'AUTO_UTILISATION' });
    });

    it('ne peut pas détecter un code déjà consommé par ce compte', async () => {
      brancher(codeBase({ usage_max_par_utilisateur: 1 }));
      journal = [{ code_id: 1, utilisateur_id: 10 }];
      expect((await service.valider('X', undefined)).valide).toBe(true);
      brancher(codeBase({ usage_max_par_utilisateur: 1 }));
      journal = [{ code_id: 1, utilisateur_id: 10 }];
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'DEJA_UTILISE' });
    });

    it('verse la commission au propriétaire, qui n’est pas l’appelant anonyme', async () => {
      brancher(codeBase({ proprietaire_id: 42, effets: [reduction(), commission()] }));
      const r = await service.valider('X', undefined, { prix: 2000 });
      expect(r.effets?.commission_pour).toBe(42);
    });
  });

  describe('cohérence des combinaisons', () => {
    it('refuse abonnement offert + réduction', () => {
      // Rien n'est encaissé : la remise ne s'applique à rien.
      expect(() => CodeValidationService.verifierCoherence([Effet.ABONNEMENT_OFFERT, Effet.REDUCTION]))
        .toThrow(BadRequestException);
    });

    it('refuse abonnement offert + commission', () => {
      // Aucun encaissement, donc aucune part à reverser.
      expect(() => CodeValidationService.verifierCoherence([Effet.ABONNEMENT_OFFERT, Effet.COMMISSION]))
        .toThrow(BadRequestException);
    });

    it('accepte les combinaisons qui ont un sens', () => {
      expect(() => CodeValidationService.verifierCoherence([Effet.REDUCTION, Effet.COMMISSION])).not.toThrow();
      expect(() => CodeValidationService.verifierCoherence([Effet.ABONNEMENT_OFFERT])).not.toThrow();
      expect(() => CodeValidationService.verifierCoherence([])).not.toThrow();
    });
  });

  describe('validation', () => {
    it('accepte un code valide et calcule la remise', async () => {
      brancher(codeBase());
      const r = await service.valider('rentree2026', 10, { prix: 2000 });
      expect(r.valide).toBe(true);
      expect(r.effets!.remise).toMatchObject({ montant_remise: 400, prix_final: 1600 });
    });

    it('refuse un code introuvable', async () => {
      brancher(null);
      expect(await service.valider('INEXISTANT', 10)).toMatchObject({ valide: false, motif: 'INTROUVABLE' });
    });

    it('refuse un code désactivé', async () => {
      brancher(codeBase({ est_actif: false }));
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'INACTIF' });
    });

    it('refuse un code hors fenêtre de validité', async () => {
      brancher(codeBase({ date_fin: new Date(Date.now() - 86400000) }));
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'EXPIRE' });

      brancher(codeBase({ date_debut: new Date(Date.now() + 86400000) }));
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'PAS_ENCORE_VALIDE' });
    });

    it('refuse un plan non éligible', async () => {
      brancher(codeBase({ plans_eligibles: [7, 8] }));
      expect(await service.valider('X', 10, { planId: 1 })).toMatchObject({ motif: 'PLAN_NON_ELIGIBLE' });
      brancher(codeBase({ plans_eligibles: [7, 8] }));
      expect((await service.valider('X', 10, { planId: 7 })).valide).toBe(true);
    });

    it('refuse d’utiliser son propre code', async () => {
      brancher(codeBase({ proprietaire_id: 10, effets: [commission()] }));
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'AUTO_UTILISATION' });
    });

    it('refuse au-delà du plafond total — « pour n personnes »', async () => {
      journal = [1, 2].map((u) => ({ code_id: 1, utilisateur_id: u }));
      brancher(codeBase({ usage_max_total: 2 }));
      expect(await service.valider('X', 99)).toMatchObject({ motif: 'QUOTA_TOTAL_ATTEINT' });
    });

    it('refuse une seconde utilisation par la même personne', async () => {
      journal = [{ code_id: 1, utilisateur_id: 10 }];
      brancher(codeBase({ usage_max_par_utilisateur: 1 }));
      expect(await service.valider('X', 10)).toMatchObject({ motif: 'DEJA_UTILISE' });
      // Une autre personne peut toujours l'utiliser.
      brancher(codeBase({ usage_max_par_utilisateur: 1 }));
      expect((await service.valider('X', 11)).valide).toBe(true);
    });

    it('lit les compteurs sur le JOURNAL, pas sur usage_actuel', async () => {
      // `usage_actuel` est un cache : un écart ne doit pas laisser passer une
      // place de trop.
      journal = [1, 2].map((u) => ({ code_id: 1, utilisateur_id: u }));
      brancher(codeBase({ usage_max_total: 2, usage_actuel: 0 }));
      expect(await service.valider('X', 99)).toMatchObject({ motif: 'QUOTA_TOTAL_ATTEINT' });
    });
  });

  describe('consommation sous verrou', () => {
    const manager = (code: any) => ({
      query: jest.fn(async (sql: string, valeurs: any[]) => {
        if (sql.includes('FOR UPDATE')) return code ? [code] : [];
        if (sql.includes('INSERT INTO codes_utilisations')) {
          journal.push({ code_id: valeurs[1], utilisateur_id: valeurs[2] });
          return [];
        }
        if (sql.includes('COUNT(*)')) return requeteJournal(sql, valeurs);
        return [];
      }),
    });

    /** Le flux réel : verrouiller, puis enregistrer si la place est libre. */
    const consommer = async (m: any, codeId: number, userId: number) => {
      const v = await service.verrouillerEtValider(m, codeId, userId);
      if (!v.ok) return v;
      await service.enregistrerUtilisation(m, codeId, userId, {});
      return v;
    };

    it('verrouille la ligne avant toute décision', async () => {
      const m = manager(codeBase({ usage_max_total: 1 }));
      await service.verrouillerEtValider(m as any, 1, 10);
      expect(m.query.mock.calls[0][0]).toContain('FOR UPDATE');
    });

    it('n’accorde qu’UNE place quand il n’en reste qu’une', async () => {
      const code = codeBase({ usage_max_total: 1 });
      const a = await consommer(manager(code), 1, 10);
      const b = await consommer(manager(code), 1, 11);
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({ ok: false, motif: 'QUOTA_TOTAL_ATTEINT' });
      expect(journal).toHaveLength(1);
    });

    it('revalide sous verrou : un code désactivé entre-temps est refusé', async () => {
      const r = await consommer(manager(codeBase({ est_actif: false })), 1, 10);
      expect(r).toMatchObject({ ok: false, motif: 'INACTIF' });
      expect(journal).toHaveLength(0);
    });

    it('refuse un code disparu entre l’aperçu et l’achat', async () => {
      expect(await consommer(manager(null), 1, 10)).toMatchObject({ ok: false, motif: 'INTROUVABLE' });
    });
  });

  describe('libération', () => {
    it('rend la place d’un abonnement annulé', async () => {
      utilisations.find.mockResolvedValue([{ id: 5, code_id: 1 }]);
      const n = await service.libererPourAbonnement(42);
      expect(n).toBe(1);
      expect(utilisations.delete).toHaveBeenCalledWith(5);
      // Le compteur dénormalisé suit, sans jamais passer sous zéro.
      expect(codes.query).toHaveBeenCalledWith(expect.stringContaining('GREATEST'), [1]);
    });

    it('ne fait rien sans utilisation liée', async () => {
      expect(await service.libererPourAbonnement(42)).toBe(0);
      expect(utilisations.delete).not.toHaveBeenCalled();
    });
  });
});
