import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AbonnementRequisGuard } from './guards/abonnement-requis.guard';
import { StatutAbonnement } from './entities/abonnement.entity';
import { TypeEvenementAbonnement } from './entities/abonnement-evenement.entity';
import { EntitlementService, Feature } from './entitlement.service';
import { AbonnementsService } from './abonnements.service';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';

const dansNJours = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe('EntitlementService', () => {
  let abonnements: any;
  let utilisateurs: any;
  let config: any;
  let quotas: any;
  let profils: any;
  let verrou: any;
  let service: EntitlementService;

  beforeEach(() => {
    abonnements = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) };
    utilisateurs = { findOne: jest.fn().mockResolvedValue({ id: 1, role: RoleType.ETUDIANT }) };
    config = { get: jest.fn().mockReturnValue(undefined) };
    // Quotas neutres : ce bloc teste l'abonnement, pas la couche quota (#245),
    // qui a son propre spec.
    quotas = {
      limite: jest.fn().mockReturnValue(5),
      compter: jest.fn().mockResolvedValue(0),
      etatPourUtilisateur: jest.fn().mockResolvedValue({
        RESOURCE_VIEW: { used: 0, limit: 5 },
        KETSIA_AI: { used: 0, limit: 1 },
      }),
    };
    profils = {
      estConforme: jest.fn().mockResolvedValue({ conforme: true, pourcentage: 100, seuil: 95, actif: false }),
    };
    verrou = { estActif: jest.fn().mockReturnValue(false) };
    service = new EntitlementService(abonnements, utilisateurs, config, quotas, profils, verrou);
  });

  it('refuse sans abonnement actif', async () => {
    const d = await service.check(1, Feature.CONCOURS_DOWNLOAD);
    expect(d).toMatchObject({ allowed: false, reason: 'SUBSCRIPTION_REQUIRED' });
  });

  it('autorise avec un abonnement actif', async () => {
    abonnements.findOne.mockResolvedValue({
      date_fin: dansNJours(10),
      plan: { code: 'MENSUEL' },
    });
    const d = await service.check(1, Feature.CONCOURS_DOWNLOAD);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('SUBSCRIBED');
    expect(d.abonnement?.planCode).toBe('MENSUEL');
  });

  it('autorise toujours un administrateur', async () => {
    utilisateurs.findOne.mockResolvedValue({ id: 9, role: RoleType.ADMIN });
    const d = await service.check(9, Feature.CONCOURS_DOWNLOAD);
    expect(d).toMatchObject({ allowed: true, reason: 'ADMIN' });
    // Inutile d'interroger les abonnements pour un admin.
    expect(abonnements.findOne).not.toHaveBeenCalled();
  });

  it('refuse un utilisateur anonyme sans requête SQL', async () => {
    expect(await service.hasActiveSubscription(undefined as any)).toBe(false);
    expect(abonnements.findOne).not.toHaveBeenCalled();
  });

  it('ne dépend pas du cron : un ACTIF échu est filtré par la requête', async () => {
    await service.abonnementActif(1);
    const where = abonnements.findOne.mock.calls[0][0].where;
    expect(where.statut).toBe(StatutAbonnement.ACTIF);
    // MoreThan(now) — sans ce filtre, un abonnement échu resterait autorisé
    // jusqu'au passage horaire du cron.
    expect(where.date_fin).toBeDefined();
  });

  describe('interrupteur du verrou', () => {
    // La lecture de la variable d'environnement a migré vers VerrouService,
    // qui la teste pour son compte. Ce qui se vérifie ici est la délégation —
    // et surtout que le pays est transmis : servir le réglage du Bénin au
    // Sénégal reviendrait à ignorer une bascule.
    it('délègue au service du verrou, pays compris', () => {
      verrou.estActif.mockReturnValue(true);
      expect(service.verrouActif('senegal')).toBe(true);
      expect(verrou.estActif).toHaveBeenCalledWith('senegal');
    });

    it('retombe sur le Bénin quand aucun pays n’est donné', () => {
      service.verrouActif();
      expect(verrou.estActif).toHaveBeenCalledWith('benin');
    });

    it('reste synchrone — le guard l’appelle à chaque téléchargement', () => {
      expect(typeof service.verrouActif('benin')).toBe('boolean');
    });
  });
});

describe('AbonnementRequisGuard', () => {
  const contexte = (utilisateurId?: number) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { utilisateurId }, method: 'GET', url: '/concours/1/telechargement' }),
      }),
    }) as any;

  let reflector: any;
  let entitlement: any;
  let guard: AbonnementRequisGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(Feature.CONCOURS_DOWNLOAD) };
    entitlement = {
      check: jest.fn().mockResolvedValue({ allowed: false, reason: 'SUBSCRIPTION_REQUIRED' }),
      verrouActif: jest.fn().mockReturnValue(true),
    };
    guard = new AbonnementRequisGuard(reflector, entitlement);
  });

  it('laisse passer une route sans @RequiresFeature', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(await guard.canActivate(contexte(1))).toBe(true);
    expect(entitlement.check).not.toHaveBeenCalled();
  });

  it('laisse passer un ayant droit', async () => {
    entitlement.check.mockResolvedValue({ allowed: true, reason: 'SUBSCRIBED' });
    expect(await guard.canActivate(contexte(1))).toBe(true);
  });

  it('refuse avec un corps exploitable par le mobile', async () => {
    await expect(guard.canActivate(contexte(1))).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(contexte(1));
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({
        statusCode: 403,
        error: 'SUBSCRIPTION_REQUIRED',
        feature: Feature.CONCOURS_DOWNLOAD,
      });
      // Un message vide obligerait le client à inventer le sien.
      expect(String(e.getResponse().message).length).toBeGreaterThan(10);
    }
  });

  it('laisse passer quand le verrou est éteint, sans supprimer le refus du journal', async () => {
    entitlement.verrouActif.mockReturnValue(false);
    const warn = jest.spyOn((guard as any).logger, 'warn').mockImplementation(() => {});

    expect(await guard.canActivate(contexte(42))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('verrou éteint'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CONCOURS_DOWNLOAD'));
  });

  it('signale QUOTA_EXCEEDED distinctement (préparé pour #245)', async () => {
    entitlement.check.mockResolvedValue({
      allowed: false,
      reason: 'QUOTA_EXCEEDED',
      quota: { used: 5, limit: 5 },
    });
    try {
      await guard.canActivate(contexte(1));
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ error: 'QUOTA_EXCEEDED', quota: { used: 5, limit: 5 } });
    }
  });
});

describe('AbonnementsService', () => {
  let abonnements: any;
  let evenements: any;
  let plansService: any;
  let entitlement: any;
  let parrainage: any;
  let codes: any;
  let service: AbonnementsService;
  const plan = { id: 1, uuid: 'p-1', code: 'MENSUEL', prix: 2000, devise: 'XOF', duree_jours: 30, est_actif: true };

  beforeEach(() => {
    abonnements = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 7, uuid: 'a-1', ...x })),
      update: jest.fn().mockResolvedValue({}),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    evenements = { create: jest.fn((x) => x), save: jest.fn(async (x) => x), find: jest.fn().mockResolvedValue([]) };
    plansService = { findByUuid: jest.fn().mockResolvedValue(plan) };
    entitlement = {
      hasActiveSubscription: jest.fn().mockResolvedValue(false),
      abonnementActif: jest.fn().mockResolvedValue(null),
      abonnementsAExpirer: jest.fn().mockResolvedValue([]),
    };
    // ParrainageService neutre : le versement de commission a son propre spec.
    parrainage = {
      resoudreParrain: jest.fn().mockResolvedValue(null),
      verserCommission: jest.fn().mockResolvedValue({ verse: false, motif: 'AUCUN_PARRAIN' }),
    };
    // Registre de codes neutre : le module codes a son propre spec.
    codes = {
      valider: jest.fn().mockResolvedValue({ valide: false, motif: 'INTROUVABLE' }),
      verrouillerEtValider: jest.fn().mockResolvedValue({ ok: true }),
      enregistrerUtilisation: jest.fn().mockResolvedValue(undefined),
      libererPourAbonnement: jest.fn().mockResolvedValue(0),
    };
    // Le DataSource n'est utilisé que pour `transaction` : on exécute le
    // callback en lui passant un manager qui délègue aux mêmes doublures.
    const dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({ getRepository: () => abonnements, query: jest.fn().mockResolvedValue([]) }),
      ),
    };
    service = new AbonnementsService(
      abonnements, evenements, plansService, entitlement, parrainage,
      dataSource as any,
      { get: () => codes } as any,
    );
    jest.spyOn(service, 'findByUuid').mockImplementation(async () => ({ uuid: 'a-1' }) as any);
  });

  it('ouvre un abonnement EN_ATTENTE, jamais ACTIF', async () => {
    await service.souscrire('benin', 3, { plan_uuid: 'p-1' });
    expect(abonnements.save).toHaveBeenCalledWith(
      expect.objectContaining({ statut: StatutAbonnement.EN_ATTENTE, montant_paye: 0 }),
    );
  });

  it('refuse de souscrire à un plan fermé', async () => {
    plansService.findByUuid.mockResolvedValue({ ...plan, est_actif: false });
    await expect(service.souscrire('benin', 3, { plan_uuid: 'p-1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse un second abonnement quand un actif existe', async () => {
    entitlement.hasActiveSubscription.mockResolvedValue(true);
    await expect(service.souscrire('benin', 3, { plan_uuid: 'p-1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('réutilise la souscription en attente au lieu d’en empiler une seconde', async () => {
    abonnements.findOne.mockResolvedValue({ id: 5, uuid: 'a-5', statut: StatutAbonnement.EN_ATTENTE });
    await service.souscrire('benin', 3, { plan_uuid: 'p-1' });
    expect(abonnements.save).toHaveBeenCalledTimes(1);
    expect(abonnements.save).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it('refuse explicitement un code saisi mais invalide', async () => {
    await expect(service.souscrire('benin', 3, { plan_uuid: 'p-1', code: 'EXPIRE' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(abonnements.save).not.toHaveBeenCalled();
  });

  it('active directement une remise de 100 % sans paiement', async () => {
    codes.valider.mockResolvedValue({
      valide: true,
      code: { id: 12, code: 'GRATUIT100' },
      effets: { remise: { montant_remise: 2000, prix_final: 0 } },
    });

    await service.souscrire('benin', 3, { plan_uuid: 'p-1', code: 'GRATUIT100' });

    expect(abonnements.save).toHaveBeenCalledWith(expect.objectContaining({
      statut: StatutAbonnement.ACTIF,
      montant_remise: 2000,
      offert: true,
    }));
  });

  describe('activation manuelle', () => {
    beforeEach(() => {
      jest.spyOn(service, 'findByUuid').mockImplementation(
        async () => ({ id: 7, uuid: 'a-1', statut: StatutAbonnement.EN_ATTENTE, plan, metadata: null }) as any,
      );
    });

    it('calcule la date de fin depuis la durée du plan', async () => {
      await service.activer('a-1', { montant_paye: 2000 }, 99);
      const sauvegarde = abonnements.save.mock.calls[0][0];
      expect(sauvegarde.statut).toBe(StatutAbonnement.ACTIF);
      const jours = Math.round((sauvegarde.date_fin - sauvegarde.date_debut) / 86400000);
      expect(jours).toBe(30);
      expect(sauvegarde.metadata).toMatchObject({ activation_manuelle: true, active_par: 99 });
    });

    it('journalise PAYE puis ACTIVE', async () => {
      await service.activer('a-1', { montant_paye: 2000 });
      const types = evenements.save.mock.calls.map((c: any[]) => c[0].type);
      expect(types).toEqual([TypeEvenementAbonnement.PAYE, TypeEvenementAbonnement.ACTIVE]);
    });

    it('traduit la violation d’unicité en 409 plutôt qu’en 500', async () => {
      abonnements.save.mockRejectedValue({ code: '23505' });
      await expect(service.activer('a-1', { montant_paye: 2000 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse de réactiver un abonnement déjà actif', async () => {
      jest.spyOn(service, 'findByUuid').mockImplementation(
        async () => ({ id: 7, statut: StatutAbonnement.ACTIF, plan }) as any,
      );
      await expect(service.activer('a-1', { montant_paye: 2000 })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('n’écrit rien quand aucun abonnement n’est échu', async () => {
    expect(await service.expirerAbonnements()).toBe(0);
    expect(abonnements.save).not.toHaveBeenCalled();
  });

  it('passe les échus à EXPIRE et les journalise', async () => {
    entitlement.abonnementsAExpirer.mockResolvedValue([{ id: 1, date_fin: new Date() }, { id: 2, date_fin: new Date() }]);
    expect(await service.expirerAbonnements()).toBe(2);
    expect(abonnements.save).toHaveBeenCalledTimes(2);
    expect(evenements.save.mock.calls.every((c: any[]) => c[0].type === TypeEvenementAbonnement.EXPIRE)).toBe(true);
  });

  it('ne fait pas échouer l’opération quand la journalisation tombe', async () => {
    evenements.save.mockRejectedValue(new Error('db down'));
    await expect(service.journaliser(1, TypeEvenementAbonnement.CREE)).resolves.toBeUndefined();
  });
});
