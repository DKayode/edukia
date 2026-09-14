import { AbonnementsController } from './abonnements.controller';
import { StatutAbonnement } from './entities/abonnement.entity';

describe('AbonnementsController', () => {
  let abonnementsService: { monAbonnement: jest.Mock };
  let entitlement: {
    hasActiveSubscription: jest.Mock;
    estAdmin: jest.Mock;
  };
  let quotas: { etatPourUtilisateur: jest.Mock };
  let controller: AbonnementsController;

  const req = { user: { utilisateurId: 22, role: 'étudiant' } };

  beforeEach(() => {
    abonnementsService = {
      monAbonnement: jest.fn(),
    };
    entitlement = {
      hasActiveSubscription: jest.fn().mockResolvedValue(false),
      estAdmin: jest.fn().mockResolvedValue(false),
    };
    quotas = {
      etatPourUtilisateur: jest.fn().mockResolvedValue({
        RESOURCE_VIEW: {
          used: 5,
          limit: 5,
          est_actif: true,
          periode_reset: 'MENSUEL',
          reinitialisation: '2026-10-01T00:00:00.000Z',
        },
        KETSIA_AI: {
          used: 0,
          limit: 1,
          est_actif: false,
          periode_reset: 'MENSUEL',
          reinitialisation: '2026-10-01T00:00:00.000Z',
        },
      }),
    };
    controller = new AbonnementsController(
      abonnementsService as any,
      {} as any,
      entitlement as any,
      quotas as any,
      {} as any,
    );
  });

  it("expose explicitement l'accès Ketsia sur un abonnement actif", async () => {
    abonnementsService.monAbonnement.mockResolvedValue({
      id: 2,
      statut: StatutAbonnement.ACTIF,
      date_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      plan: { code: 'MENSUEL' },
    });

    await expect(controller.monAbonnement(req as any)).resolves.toMatchObject({
      statut: StatutAbonnement.ACTIF,
      abonnement_actif: true,
      ketsia_actif: true,
    });
  });

  it("n'annonce pas Ketsia actif sur un abonnement en attente", async () => {
    abonnementsService.monAbonnement.mockResolvedValue({
      id: 3,
      statut: StatutAbonnement.EN_ATTENTE,
      date_fin: null,
      plan: { code: 'MENSUEL' },
    });

    await expect(controller.monAbonnement(req as any)).resolves.toMatchObject({
      statut: StatutAbonnement.EN_ATTENTE,
      abonnement_actif: false,
      ketsia_actif: false,
    });
  });

  it("rend Ketsia accessible et illimité dans mes-quotas quand l'utilisateur est abonné", async () => {
    entitlement.hasActiveSubscription.mockResolvedValue(true);

    const etat = await controller.mesQuotas('benin', req as any);

    expect(etat.KETSIA_AI).toMatchObject({
      used: 0,
      limit: 1,
      est_actif: false,
      quota_gratuit_actif: false,
      abonnement_actif: true,
      acces_actif: true,
      illimite: true,
      quota_applicable: false,
      reason: 'SUBSCRIBED',
    });
    expect(etat.RESOURCE_VIEW).toMatchObject({
      abonnement_actif: true,
      acces_actif: true,
      illimite: true,
      quota_applicable: false,
      reason: 'SUBSCRIBED',
    });
  });

  it("garde le refus quota explicite pour un non-abonné qui a épuisé son quota", async () => {
    const etat = await controller.mesQuotas('benin', req as any);

    expect(etat.RESOURCE_VIEW).toMatchObject({
      abonnement_actif: false,
      acces_actif: false,
      illimite: false,
      quota_applicable: true,
      reason: 'QUOTA_EXCEEDED',
    });
    expect(etat.KETSIA_AI).toMatchObject({
      abonnement_actif: false,
      acces_actif: true,
      illimite: true,
      quota_applicable: false,
      reason: 'FREE_QUOTA',
    });
  });
});
