import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let dataSource: { query: jest.Mock };
  let quotas: { etatPourUtilisateur: jest.Mock };
  let service: DashboardService;
  let requetes: { sql: string; params: unknown[] }[];

  beforeEach(() => {
    requetes = [];
    dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        requetes.push({ sql, params });

        if (sql.includes('generate_series')) {
          return [{ date: '2026-09-14', acces: 2 }];
        }
        if (sql.includes('FROM utilisateurs')) {
          return [{ pays: 'senegal' }];
        }
        if (sql.includes('AS streak_jours')) {
          return [{ streak_jours: 3, derniere_connexion: '2026-09-14T08:00:00.000Z' }];
        }
        if (sql.includes('AS epreuves_consultees')) {
          return [{
            epreuves_consultees: 4,
            examens_nationaux_consultes: 2,
            concours_consultes: 1,
            ressources_academiques_consultees: 7,
          }];
        }
        if (sql.includes('AS soumissions')) {
          return [{ soumissions: 1 }];
        }
        return [{}];
      }),
    };
    quotas = {
      etatPourUtilisateur: jest.fn().mockResolvedValue({
        RESOURCE_VIEW: {
          used: 2,
          limit: 5,
          est_actif: true,
          periode_reset: 'MENSUEL',
          reinitialisation: '2026-10-01T00:00:00.000Z',
        },
        KETSIA_AI: {
          used: 1,
          limit: 1,
          est_actif: true,
          periode_reset: 'MENSUEL',
          reinitialisation: '2026-10-01T00:00:00.000Z',
        },
      }),
    };
    service = new DashboardService(dataSource as any, quotas as any);
  });

  it("renvoie les KPI de l'utilisateur actif, y compris ses quotas", async () => {
    const activite = await service.getActivite(42, 28);

    expect(activite).toMatchObject({
      epreuves_consultees: 4,
      examens_nationaux_consultes: 2,
      concours_consultes: 1,
      ressources_academiques_consultees: 7,
      soumissions: 1,
      kpis: {
        epreuves_consultees: 4,
        examens_nationaux_consultes: 2,
        concours_consultes: 1,
        ressources_academiques_consultees: 7,
        quota_ressources_utilise: 2,
        quota_ressources_restant: 3,
        quota_ressources_pourcentage: 40,
        quota_ketsia_utilise: 1,
        quota_ketsia_restant: 0,
        quota_ketsia_pourcentage: 100,
      },
      quotas: {
        RESOURCE_VIEW: { used: 2, limit: 5, remaining: 3, pourcentage: 40 },
        KETSIA_AI: { used: 1, limit: 1, remaining: 0, pourcentage: 100 },
      },
    });
    expect(quotas.etatPourUtilisateur).toHaveBeenCalledWith(42, 'senegal');
  });

  it("garde les compteurs personnels filtrés uniquement sur l'utilisateur connecté", async () => {
    await service.getActivite(42, 28);

    const acces = requetes.find((r) => r.sql.includes('AS epreuves_consultees'))!;
    const soumissions = requetes.find((r) => r.sql.includes('AS soumissions'))!;

    expect(acces.sql).toContain('utilisateur_id = $1');
    expect(acces.sql).toContain("resource_type IN ('epreuve', 'examen_national', 'concours')");
    expect(acces.sql).not.toContain('AND pays = $2');
    expect(acces.params).toEqual([42]);
    expect(soumissions.sql).toContain('soumis_par_id = $1');
    expect(soumissions.sql).not.toContain('AND pays = $2');
    expect(soumissions.params).toEqual([42]);
  });

  it("utilise le pays de l'utilisateur seulement pour la règle de quota", async () => {
    await service.getActivite(42, 7);

    const paysUtilisateur = requetes.find((r) => r.sql.includes('FROM utilisateurs'))!;
    const serie = requetes.find((r) => r.sql.includes('generate_series'))!;

    expect(paysUtilisateur.params).toEqual([42]);
    expect(serie.sql).not.toContain('ra.pays');
    expect(serie.params).toEqual([42, 7]);
    expect(quotas.etatPourUtilisateur).toHaveBeenCalledWith(42, 'senegal');
  });
});
