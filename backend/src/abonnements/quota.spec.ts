import { QuotaService } from './quota.service';
import { PeriodeReset } from './entities/configuration-quota.entity';
import { FeatureQuota } from './entities/quota-consommation.entity';
import { EntitlementService, Feature } from './entitlement.service';
import { RoleType } from '../utilisateurs/entities/utilisateur.entity';

/**
 * Dépôt en mémoire respectant l'unicité (utilisateur, feature, type, id) —
 * c'est elle qui porte la correction du quota, la simuler est donc le cœur du
 * test.
 */
const depotEnMemoire = () => {
  const lignes: any[] = [];
  // La période fait partie de la clé : c'est elle qui produit la remise à zéro.
  const cle = (l: any) => `${l.utilisateur_id}|${l.feature}|${l.resource_type}|${l.resource_id}|${l.periode}`;
  return {
    lignes,
    count: jest.fn(async ({ where }: any) =>
      lignes.filter((l) =>
        l.utilisateur_id === where.utilisateur_id &&
        l.feature === where.feature &&
        (where.periode === undefined || l.periode === where.periode)).length),
    findOne: jest.fn(async ({ where }: any) =>
      lignes.find((l) => cle(l) === cle(where)) ?? null),
    find: jest.fn(async ({ where }: any) =>
      lignes.filter((l) =>
        l.utilisateur_id === where.utilisateur_id &&
        l.feature === where.feature &&
        l.resource_type === where.resource_type &&
        (where.periode === undefined || l.periode === where.periode))),
    insert: jest.fn(async (l: any) => {
      if (lignes.some((x) => cle(x) === cle(l))) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      lignes.push(l);
      return { identifiers: [] };
    }),
    query: jest.fn(async () => []),
  };
};

/**
 * Configurations en mémoire. `est_actif: true` ici parce que ces tests portent
 * sur le comportement du quota ; en base il est semé DÉSACTIVÉ, ce que couvre
 * le test « inactif par défaut » plus bas.
 */
const depotConfig = (surcharges: any[] = []) => {
  const base = [
    { uuid: 'c-1', pays: 'benin', feature: 'RESOURCE_VIEW', limite: 5, periode_reset: PeriodeReset.MENSUEL, est_actif: true },
    { uuid: 'c-2', pays: 'benin', feature: 'KETSIA_AI', limite: 1, periode_reset: PeriodeReset.MENSUEL, est_actif: true },
  ].map((c) => ({ ...c, ...(surcharges.find((s) => s.feature === c.feature) ?? {}) }));
  return {
    lignes: base,
    findOne: jest.fn(async ({ where }: any) =>
      base.find((c) => (where.uuid ? c.uuid === where.uuid : c.feature === where.feature && c.pays === where.pays)) ?? null),
    find: jest.fn(async () => base),
    save: jest.fn(async (c: any) => c),
  };
};

describe('QuotaService', () => {
  let depot: ReturnType<typeof depotEnMemoire>;
  let service: QuotaService;
  const consommer = (id: number, type: any = 'epreuve', feature = FeatureQuota.RESOURCE_VIEW) =>
    service.consommer(1, feature, type, id, 'benin');

  beforeEach(() => {
    depot = depotEnMemoire();
    service = new QuotaService(depot as any, depotConfig() as any);
  });

  it('accorde les 5 premières ressources distinctes', async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await consommer(i);
      expect(r).toMatchObject({ allowed: true, nouveau: true, used: i });
    }
  });

  it('refuse la 6ᵉ ressource distincte', async () => {
    for (let i = 1; i <= 5; i++) await consommer(i);
    const r = await consommer(6);
    expect(r).toMatchObject({ allowed: false, used: 5, limit: 5 });
  });

  it('ne recompte pas une ressource déjà consultée', async () => {
    await consommer(1);
    const r = await consommer(1);
    expect(r).toMatchObject({ allowed: true, nouveau: false, used: 1 });
  });

  it('laisse rouvrir une ressource déjà vue même quota épuisé', async () => {
    for (let i = 1; i <= 5; i++) await consommer(i);
    const r = await consommer(3);
    expect(r).toMatchObject({ allowed: true, nouveau: false });
  });

  it('partage le pool entre épreuves et examens nationaux', async () => {
    await consommer(1, 'epreuve');
    await consommer(2, 'epreuve');
    await consommer(1, 'examen_national');
    await consommer(2, 'examen_national');
    await consommer(3, 'examen_national');
    // 5 consommées, toutes features confondues : la suivante doit tomber.
    expect(await consommer(9, 'epreuve')).toMatchObject({ allowed: false, used: 5 });
  });

  it('distingue une épreuve et un examen national de même identifiant', async () => {
    await consommer(7, 'epreuve');
    const r = await consommer(7, 'examen_national');
    expect(r).toMatchObject({ allowed: true, nouveau: true, used: 2 });
  });

  it('tient son propre plafond pour Ketsia', async () => {
    expect(await consommer(1, 'epreuve', FeatureQuota.KETSIA_AI))
      .toMatchObject({ allowed: true, used: 1, limit: 1 });
    expect(await consommer(2, 'epreuve', FeatureQuota.KETSIA_AI))
      .toMatchObject({ allowed: false });
    // Revenir sur la ressource déjà décomptée reste permis.
    expect(await consommer(1, 'epreuve', FeatureQuota.KETSIA_AI))
      .toMatchObject({ allowed: true, nouveau: false });
  });

  it('ne mélange pas les compteurs de deux features', async () => {
    for (let i = 1; i <= 5; i++) await consommer(i);
    expect(await consommer(1, 'epreuve', FeatureQuota.KETSIA_AI)).toMatchObject({ allowed: true });
  });

  it('absorbe une insertion concurrente sans consommer deux unités', async () => {
    // Deux requêtes simultanées sur la MÊME ressource : la seconde tombe sur le
    // conflit d'unicité et doit être autorisée sans rien décompter de plus.
    const [a, b] = await Promise.all([consommer(4), consommer(4)]);
    expect(a.allowed && b.allowed).toBe(true);
    expect(depot.lignes.filter((l) => l.resource_id === 4)).toHaveLength(1);
  });

  it('sérialise les consommations d’un même compteur avant de compter', async () => {
    await consommer(4);
    expect(depot.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [expect.stringContaining('quota:benin:1:RESOURCE_VIEW:')],
    );
  });

  it('rend les identifiants consommés pour le drapeau deja_consultee', async () => {
    await consommer(3);
    await consommer(8);
    const set = await service.ressourcesConsommees(1, FeatureQuota.RESOURCE_VIEW, 'epreuve');
    expect([...set].sort()).toEqual([3, 8]);
  });

  describe('remise à zéro mensuelle', () => {
    it('étiquette les consommations avec le mois courant', async () => {
      const r = await consommer(1);
      expect(r.periode).toMatch(/^\d{4}-\d{2}$/);
      expect(depot.lignes[0].periode).toBe(r.periode);
    });

    it('rend le quota au changement de mois', async () => {
      for (let i = 1; i <= 5; i++) await consommer(i);
      expect(await consommer(6)).toMatchObject({ allowed: false });

      // On simule le mois suivant en réétiquetant les lignes déjà posées :
      // elles appartiennent à une période close et ne comptent plus.
      depot.lignes.forEach((l) => (l.periode = '2000-01'));

      expect(await consommer(6)).toMatchObject({ allowed: true, nouveau: true, used: 1 });
    });

    it('recompte une ressource déjà vue le mois précédent', async () => {
      await consommer(3);
      depot.lignes.forEach((l) => (l.periode = '2000-01'));
      // Le quota est mensuel : la même ressource redevient payante en unité.
      expect(await consommer(3)).toMatchObject({ allowed: true, nouveau: true, used: 1 });
    });

    it('n’étiquette pas par mois quand le réglage est AVIE', async () => {
      service = new QuotaService(
        depot as any,
        depotConfig([{ feature: 'RESOURCE_VIEW', periode_reset: PeriodeReset.AVIE }]) as any,
      );
      const r = await consommer(1);
      expect(r.periode).toBe('AVIE');
    });
  });

  describe('configuration administrable', () => {
    it('lit le plafond en base plutôt qu’une constante', async () => {
      service = new QuotaService(depot as any, depotConfig([{ feature: 'RESOURCE_VIEW', limite: 2 }]) as any);
      await consommer(1);
      await consommer(2);
      expect(await consommer(3)).toMatchObject({ allowed: false, limit: 2 });
    });

    it('laisse tout passer quand le quota est désactivé, SANS rien enregistrer', async () => {
      service = new QuotaService(depot as any, depotConfig([{ feature: 'RESOURCE_VIEW', est_actif: false }]) as any);
      for (let i = 1; i <= 20; i++) {
        expect((await consommer(i)).allowed).toBe(true);
      }
      // Point décisif : ne rien enregistrer tant que le quota est inactif.
      // Sinon, le jour où l'administration l'active, des utilisateurs se
      // retrouveraient bloqués pour des lectures faites quand rien ne les
      // prévenait.
      expect(depot.lignes).toHaveLength(0);
    });

    it('se replie sur les valeurs par défaut sans configuration en base', async () => {
      const vide = { findOne: jest.fn(async () => null), find: jest.fn(async () => []), save: jest.fn() };
      service = new QuotaService(depot as any, vide as any);
      expect((await consommer(1)).limit).toBe(5);
    });

    it('signale un quota désactivé dans l’état', async () => {
      service = new QuotaService(depot as any, depotConfig([{ feature: 'RESOURCE_VIEW', est_actif: false }]) as any);
      const etat = await service.etatPourUtilisateur(1);
      expect(etat.RESOURCE_VIEW.est_actif).toBe(false);
    });

    it('annonce la date de remise à zéro', async () => {
      const etat = await service.etatPourUtilisateur(1);
      expect(etat.RESOURCE_VIEW.periode_reset).toBe(PeriodeReset.MENSUEL);
      expect(new Date(etat.RESOURCE_VIEW.reinitialisation).getUTCDate()).toBe(1);
      expect(new Date(etat.RESOURCE_VIEW.reinitialisation).getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('ne requête pas la base pour un utilisateur anonyme', async () => {
    expect(await service.compter(undefined as any, FeatureQuota.RESOURCE_VIEW)).toBe(0);
    expect((await service.ressourcesConsommees(undefined as any, FeatureQuota.RESOURCE_VIEW, 'epreuve')).size).toBe(0);
    expect(depot.count).not.toHaveBeenCalled();
  });
});

describe('EntitlementService — quotas', () => {
  let abonnements: any, utilisateurs: any, config: any, quotas: QuotaService, profils: any, service: EntitlementService;

  beforeEach(() => {
    abonnements = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) };
    utilisateurs = { findOne: jest.fn().mockResolvedValue({ id: 1, role: RoleType.ETUDIANT }) };
    config = { get: jest.fn().mockReturnValue('true') };
    quotas = new QuotaService(depotEnMemoire() as any, depotConfig() as any);
    profils = { estConforme: jest.fn().mockResolvedValue({ conforme: true, pourcentage: 100, seuil: 95, actif: false }) };
    service = new EntitlementService(abonnements, utilisateurs, config, quotas, profils);
  });

  it('autorise une épreuve sur le quota gratuit', async () => {
    const d = await service.check(1, Feature.EPREUVE_VIEW, RoleType.ETUDIANT);
    expect(d).toMatchObject({ allowed: true, reason: 'FREE_QUOTA', quota: { used: 0, limit: 5 } });
  });

  it('refuse une épreuve quota épuisé', async () => {
    for (let i = 1; i <= 5; i++) await quotas.consommer(1, FeatureQuota.RESOURCE_VIEW, 'epreuve', i, 'benin');
    const d = await service.check(1, Feature.EPREUVE_VIEW, RoleType.ETUDIANT);
    expect(d).toMatchObject({ allowed: false, reason: 'QUOTA_EXCEEDED', quota: { used: 5, limit: 5 } });
  });

  it('n’accorde AUCUN quota gratuit aux concours', async () => {
    const d = await service.check(1, Feature.CONCOURS_DOWNLOAD, RoleType.ETUDIANT);
    expect(d).toMatchObject({ allowed: false, reason: 'SUBSCRIPTION_REQUIRED' });
    expect(d.quota).toBeUndefined();
  });

  it('donne des décisions divergentes selon la feature', async () => {
    for (let i = 1; i <= 5; i++) await quotas.consommer(1, FeatureQuota.RESOURCE_VIEW, 'epreuve', i, 'benin');
    const droits = await service.mesDroits(1, RoleType.ETUDIANT);
    expect(droits[Feature.EPREUVE_VIEW].reason).toBe('QUOTA_EXCEEDED');
    expect(droits[Feature.KETSIA_AI].reason).toBe('FREE_QUOTA');
    expect(droits[Feature.CONCOURS_DOWNLOAD].reason).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('un abonné n’est jamais soumis au quota', async () => {
    abonnements.findOne.mockResolvedValue({ date_fin: new Date(Date.now() + 86400000), plan: { code: 'MENSUEL' } });
    const droits = await service.mesDroits(1, RoleType.ETUDIANT);
    expect(Object.values(droits).every((d: any) => d.reason === 'SUBSCRIBED')).toBe(true);
  });

  it('n’annonce aucun quota quand il est désactivé', async () => {
    quotas = new QuotaService(
      depotEnMemoire() as any,
      depotConfig([{ feature: 'RESOURCE_VIEW', est_actif: false }]) as any,
    );
    profils = { estConforme: jest.fn().mockResolvedValue({ conforme: true, pourcentage: 100, seuil: 95, actif: false }) };
    service = new EntitlementService(abonnements, utilisateurs, config, quotas, profils);
    const droits = await service.mesDroits(1, RoleType.ETUDIANT);
    expect(droits[Feature.EPREUVE_VIEW]).toMatchObject({ allowed: true, reason: 'FREE_QUOTA' });
    expect(droits[Feature.EPREUVE_VIEW].quota).toBeUndefined();
  });

  describe('profil incomplet (#259)', () => {
    const profilRefuse = () =>
      profils.estConforme.mockResolvedValue({ conforme: false, pourcentage: 35, seuil: 95, actif: true });

    it('refuse une épreuve, avec le pourcentage atteint', async () => {
      profilRefuse();
      const d = await service.check(1, Feature.EPREUVE_VIEW, RoleType.ETUDIANT);
      expect(d).toMatchObject({ allowed: false, reason: 'PROFIL_INCOMPLET', quota: { used: 35, limit: 95 } });
    });

    it('PRIME sur l’abonnement — un abonné au profil incomplet est refusé', async () => {
      profilRefuse();
      abonnements.findOne.mockResolvedValue({ date_fin: new Date(Date.now() + 86400000), plan: { code: 'MENSUEL' } });
      const d = await service.check(1, Feature.EPREUVE_VIEW, RoleType.ETUDIANT);
      expect(d.reason).toBe('PROFIL_INCOMPLET');
    });

    it('ne bloque PAS un administrateur', async () => {
      profilRefuse();
      const d = await service.check(9, Feature.CONCOURS_DOWNLOAD, RoleType.ADMIN);
      expect(d).toMatchObject({ allowed: true, reason: 'ADMIN' });
      // Inutile même de calculer la complétion pour un admin.
      expect(profils.estConforme).not.toHaveBeenCalled();
    });

    it('ne concerne pas AI_STATS — la fonctionnalité n’existe pas encore', async () => {
      profilRefuse();
      const d = await service.check(1, Feature.AI_STATS, RoleType.ETUDIANT);
      expect(d.reason).toBe('SUBSCRIPTION_REQUIRED');
    });

    it('marque toutes les fonctionnalités concernées dans mes-droits', async () => {
      profilRefuse();
      const droits = await service.mesDroits(1, RoleType.ETUDIANT);
      for (const f of [Feature.EPREUVE_VIEW, Feature.EXAMEN_NAT_VIEW, Feature.KETSIA_AI, Feature.CONCOURS_DOWNLOAD]) {
        expect(droits[f].reason).toBe('PROFIL_INCOMPLET');
      }
    });

    it('laisse passer quand le seuil est inactif', async () => {
      profils.estConforme.mockResolvedValue({ conforme: true, pourcentage: 35, seuil: 95, actif: false });
      const d = await service.check(1, Feature.EPREUVE_VIEW, RoleType.ETUDIANT);
      expect(d.reason).toBe('FREE_QUOTA');
    });
  });

  it('un admin n’est jamais soumis au quota', async () => {
    const droits = await service.mesDroits(9, RoleType.ADMIN);
    expect(Object.values(droits).every((d: any) => d.reason === 'ADMIN')).toBe(true);
    expect(abonnements.findOne).not.toHaveBeenCalled();
  });
});
