import { KpiService } from './kpi.service';

/**
 * Le SQL lui-même est vérifié sur la base (voir la vérification devstack de
 * #260) ; ce qui se teste ici est ce qu'aucune requête ne dit : l'assemblage
 * des sections, la carte des modules, et la promesse que les seize indicateurs
 * historiques n'ont pas bougé de place.
 */
describe('KpiService', () => {
  let dataSource: any;
  let profils: any;
  let service: KpiService;
  let requetes: string[];

  /** Renvoie des lignes selon un fragment reconnu dans la requête. */
  const reponses = (table: { motif: string; lignes: any[] }[]) =>
    jest.fn(async (sql: string) => {
      requetes.push(sql);
      const t = table.find((e) => sql.includes(e.motif));
      return t ? t.lignes : [{}];
    });

  const LIGNES_PAR_DEFAUT = [
    { motif: 'pg_timezone_names', lignes: [{ zone: 'Africa/Porto-Novo' }] },
    { motif: 'AS total_users', lignes: [{
      total_users: 100,
      teachers: 15,
      others: 25,
      age_under_18: 10,
      age_18_25: 30,
      age_26_35: 40,
      age_over_35: 20,
      users_age_35: 80,
      female_users: 40,
      female_age_35: 30,
      rural_users: 15,
      disability_users: 5,
      learners: 60,
      learners_age_under_18: 10,
      learners_age_18_25: 25,
      learners_age_26_35: 20,
      learners_age_over_35: 5,
      learners_age_35: 55,
      learners_age_35_female: 25,
      female_learners: 28,
      rural_learners: 10,
      disability_learners: 3,
    }] },
    { motif: 'AS users_logged_in', lignes: [{ users_logged_in: 20, learners_logged_in: 12 }] },
    { motif: 'AS last_week', lignes: [{ last_week: 5, last_two_weeks: 8, last_month: 11 }] },
    { motif: 'AS active_learners', lignes: [{ active_learners: 14 }] },
    { motif: 'GROUP BY resource_type', lignes: [
      { resource_type: 'opportunite', vues: 30, utilisateurs: 12 },
      { resource_type: 'forum', vues: 4, utilisateurs: 3 },
    ]},
    { motif: 'ORDER BY vues DESC', lignes: [{ id: 58, titre: 'Bourse marocaine', vues: 18, utilisateurs: 9 }] },
    { motif: 'GROUP BY o.type', lignes: [
      { type: 'Bourses', vues: 18, utilisateurs: 9 },
      { type: 'Stages', vues: 12, utilisateurs: 3 },
    ]},
    { motif: 'AS n\n', lignes: [{ n: 14 }] },
    { motif: 'UNION ALL', lignes: [
      { type: 'opportunite', publies: 2, total: 35 },
      { type: 'forum', publies: 54, total: 56 },
    ]},
    { motif: 'AS forums_ouverts', lignes: [{ forums_ouverts: 54, commentaires: 11, commentateurs: 10, likes: 132, likeurs: 108 }] },
    { motif: 'AS prestataires_inscrits', lignes: [{ prestataires_inscrits: 219, prestataires_total: 219, recruteurs_inscrits: 16, recruteurs_total: 16, services_publies: 108, offres_publiees: 7, avis_deposes: 1 }] },
    { motif: 'AS cohorte', lignes: [{ cohorte: 200, actives: 150, revenus_j7: 60, revenus_j30: 90 }] },
    { motif: 'AS wau', lignes: [{ wau: 18, mau: 20 }] },
    { motif: 'AS abonnements_actifs', lignes: [{ abonnements_actifs: 0, abonnements_souscrits: 14, portefeuilles: 5, transactions: 24 }] },
    { motif: 'AS ressources_depuis', lignes: [{ ressources_depuis: '2026-07-01', connexions_depuis: '2026-08-11', audience_modules_depuis: null }] },
  ];

  beforeEach(() => {
    requetes = [];
    dataSource = { query: reponses(LIGNES_PAR_DEFAUT) };
    profils = {
      distribution: jest.fn().mockResolvedValue({
        total: 100,
        repartition: [{ pourcentage: 20, comptes: 50 }, { pourcentage: 40, comptes: 50 }],
      }),
    };
    service = new KpiService(dataSource, { getTimezone: () => 'Africa/Porto-Novo' } as any, profils);
  });

  const appel = () => service.getKpis('benin', '2026-01-01', '2026-09-08');

  describe('non-régression des 16 indicateurs', () => {
    it('conserve les chemins JSON historiques', async () => {
      const d: any = await appel();
      // La page existante lit exactement ces chemins ; les déplacer la casse
      // sans que rien ne le signale.
      expect(d.utilisateurs.total).toBe(100);
      expect(d.apprenants.total).toBe(60);
      expect(d.utilisateurs.connectes).toBe(20);
      expect(d.engagement.apprenants_connectes).toBe(12);
      expect(d.engagement.apprenants_ressource).toEqual({ semaine: 5, deux_semaines: 8, mois: 11 });
      expect(d.periode).toEqual({ startDate: '2026-01-01', endDate: '2026-09-08' });
    });

    it('expose les nouveaux indicateurs de population et tranches d’âge (#228)', async () => {
      const d: any = await appel();
      expect(d.utilisateurs.professeurs).toBe(15);
      expect(d.utilisateurs.autres).toBe(25);
      expect(d.utilisateurs.age_ranges).toEqual({
        moins_18: 10,
        de_18_25: 30,
        de_26_35: 40,
        plus_35: 20,
      });
      expect(d.apprenants.age_ranges).toEqual({
        moins_18: 10,
        de_18_25: 25,
        de_26_35: 20,
        plus_35: 5,
      });
    });

    it('expose les apprenants actifs calculés sur 30 jours (#228)', async () => {
      const d: any = await appel();
      expect(d.engagement.apprenants_actifs).toBe(14);
    });
  });

  describe('audience par module', () => {
    it('liste les sept modules, y compris ceux sans consultation', async () => {
      const d: any = await appel();
      expect(d.audience.modules).toHaveLength(7);
      expect(d.audience.modules.map((m: any) => m.type)).toEqual([
        'opportunite', 'offre', 'service', 'evenement', 'parcours', 'forum', 'publicite',
      ]);
    });

    it('reporte les chiffres du module et ses fiches les plus vues', async () => {
      const d: any = await appel();
      const opp = d.audience.modules.find((m: any) => m.type === 'opportunite');
      expect(opp).toMatchObject({ libelle: 'Opportunités', vues: 30, utilisateurs: 12 });
      expect(opp.top[0]).toMatchObject({ id: 58, titre: 'Bourse marocaine', vues: 18 });
    });

    it('laisse un module non consulté à zéro, sans requête de top', async () => {
      const d: any = await appel();
      const service_ = d.audience.modules.find((m: any) => m.type === 'service');
      expect(service_).toMatchObject({ vues: 0, utilisateurs: 0, top: [] });
      // Une requête « top » par module vide serait sept allers-retours pour rien.
      expect(requetes.filter((q) => q.includes('ORDER BY vues DESC'))).toHaveLength(2);
    });

    it('ne somme pas les utilisateurs distincts entre modules', async () => {
      const d: any = await appel();
      // 12 + 3 = 15, mais qui a visité deux modules ne compte qu'une fois : 14.
      expect(d.audience.utilisateurs_distincts).toBe(14);
      expect(d.audience.total_vues).toBe(34);
    });

    it('scinde l’audience des opportunités en bourses et stages (#228)', async () => {
      const d: any = await appel();
      expect(d.audience.opportunites).toEqual({
        bourses: { vues: 18, utilisateurs: 9 },
        stages: { vues: 12, utilisateurs: 3 },
      });
    });
  });

  describe('offre de contenu', () => {
    it('exclut les forums supprimés du décompte', async () => {
      await appel();
      const q = requetes.find((r) => r.includes('FROM forums') && r.includes('UNION ALL'));
      expect(q).toContain('deleted_at IS NULL');
    });

    it('lit la bonne colonne de date pour chaque module', async () => {
      await appel();
      const q = requetes.find((r) => r.includes('UNION ALL'))!;
      // Les tables n'ont pas la même convention ; s'y tromper ferait afficher 0.
      expect(q).toMatch(/FROM opportunites/);
      expect(q).toContain('date_creation');
      expect(q).toContain('created_at');
    });
  });

  describe('croissance', () => {
    it('calcule activation et rétention en pourcentage d’une décimale', async () => {
      const d: any = await appel();
      expect(d.croissance.activation).toEqual({ cohorte: 200, actives: 150, taux: 75 });
      expect(d.croissance.retention).toEqual({ j7: 30, j30: 45 });
    });

    it('calcule le collage WAU/MAU', async () => {
      const d: any = await appel();
      expect(d.croissance.assiduite).toEqual({ wau: 18, mau: 20, collage: 90 });
    });

    it('réutilise le calcul de complétion de #259 plutôt qu’une seconde définition', async () => {
      const d: any = await appel();
      expect(profils.distribution).toHaveBeenCalledWith('benin');
      // (20×50 + 40×50) / 100 = 30
      expect(d.croissance.profil).toEqual({ completion_moyenne: 30, comptes: 100 });
    });

    it('ne divise pas par zéro sur une cohorte vide', async () => {
      dataSource.query = reponses(
        LIGNES_PAR_DEFAUT.map((e) =>
          e.motif === 'AS cohorte'
            ? { motif: e.motif, lignes: [{ cohorte: 0, actives: 0, revenus_j7: 0, revenus_j30: 0 }] }
            : e,
        ),
      );
      const d: any = await appel();
      expect(d.croissance.activation.taux).toBe(0);
      expect(d.croissance.retention).toEqual({ j7: 0, j30: 0 });
    });

    it('rapporte 0 abonnement actif sans le maquiller', async () => {
      const d: any = await appel();
      // La fonctionnalité est livrée désactivée : ce 0 est un état, pas un échec.
      expect(d.croissance.monetisation.abonnements_actifs).toBe(0);
      expect(d.croissance.monetisation.transactions).toBe(24);
    });
  });

  describe('journaux', () => {
    it('expose la date de début de chaque journal', async () => {
      const d: any = await appel();
      expect(d.journaux.ressources_depuis).toBe('2026-07-01');
      expect(d.journaux.connexions_depuis).toBe('2026-08-11');
    });

    it('laisse null tant qu’aucune fiche de module n’a été consultée', async () => {
      const d: any = await appel();
      // Le front doit alors dire « pas encore de données », et non afficher un
      // zéro qui se lirait comme un désintérêt.
      expect(d.journaux.audience_modules_depuis).toBeNull();
    });
  });
});
