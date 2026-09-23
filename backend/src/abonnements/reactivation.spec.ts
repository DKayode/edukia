import { ConflictException } from '@nestjs/common';
import { AbonnementsService } from './abonnements.service';
import { StatutAbonnement } from './entities/abonnement.entity';

/**
 * Revenir sur une annulation. `activer()` refuse un abonnement ANNULE — à
 * raison — mais laissait l'administration sans recours face à une annulation
 * par erreur, sinon créer une souscription à 0 F détachée du paiement encaissé.
 */
describe('AbonnementsService — réactivation', () => {
  let abonnements: any, evenements: any, service: AbonnementsService;

  const HIER = new Date(Date.now() - 86400000);
  const DEMAIN = new Date(Date.now() + 86400000);
  const AN_DERNIER = new Date(Date.now() - 365 * 86400000);

  const abo = (surcharges: any = {}) => ({
    id: 1, uuid: 'a-1', utilisateur_id: 7,
    statut: StatutAbonnement.ANNULE,
    date_debut: AN_DERNIER, date_fin: DEMAIN,
    montant_paye: 15000, metadata: { reference_paiement: 'EDK-123' },
    plan: { duree_jours: 365 },
    ...surcharges,
  });

  const enregistre = () => abonnements.save.mock.calls[0][0];

  beforeEach(() => {
    const courant = abo();
    abonnements = {
      findOne: jest.fn().mockResolvedValue(courant),
      save: jest.fn(async (a) => a),
    };
    evenements = { save: jest.fn(async (e) => e), create: jest.fn((e) => e) };
    service = new AbonnementsService(
      abonnements, evenements, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  });

  it('rend le statut ACTIF en conservant les dates d’origine', async () => {
    await service.reactiver('a-1', 'Annulation par erreur', 42);
    const s = enregistre();
    expect(s.statut).toBe(StatutAbonnement.ACTIF);
    // Le point qui compte : l'abonné ne gagne pas une période pleine parce
    // qu'une erreur a été corrigée.
    expect(s.date_debut).toBe(AN_DERNIER);
    expect(s.date_fin).toBe(DEMAIN);
  });

  it('conserve le montant payé et la référence du paiement', async () => {
    await service.reactiver('a-1', 'motif', 42);
    const s = enregistre();
    expect(s.montant_paye).toBe(15000);
    expect(s.metadata.reference_paiement).toBe('EDK-123');
  });

  it('consigne qui a réactivé, quand et pourquoi', async () => {
    await service.reactiver('a-1', 'Paiement Stripe confirmé', 42);
    expect(enregistre().metadata).toMatchObject({
      reactivation_manuelle: true,
      reactive_par: 42,
      motif_reactivation: 'Paiement Stripe confirmé',
    });
  });

  it('restaure en EXPIRE un abonnement dont la période est passée', async () => {
    // Le rendre ACTIF alors qu'il est échu serait un mensonge : `check()` le
    // traiterait de toute façon comme expiré.
    abonnements.findOne.mockResolvedValue(abo({ date_fin: HIER }));
    await service.reactiver('a-1', 'motif', 42);
    expect(enregistre().statut).toBe(StatutAbonnement.EXPIRE);
  });

  describe('refus', () => {
    it('refuse un abonnement déjà actif', async () => {
      abonnements.findOne.mockResolvedValue(abo({ statut: StatutAbonnement.ACTIF }));
      await expect(service.reactiver('a-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse un abonnement en attente — il faut l’activer, pas le réactiver', async () => {
      abonnements.findOne.mockResolvedValue(abo({ statut: StatutAbonnement.EN_ATTENTE }));
      await expect(service.reactiver('a-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse un abonnement annulé qui n’a jamais été activé', async () => {
      // Sans période d'origine, il n'y a rien à restaurer.
      abonnements.findOne.mockResolvedValue(abo({ date_debut: null, date_fin: null }));
      await expect(service.reactiver('a-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse si l’utilisateur s’est réabonné entre-temps', async () => {
      // L'index unique n'autorise qu'un actif par compte.
      abonnements.save.mockRejectedValue({ code: '23505' });
      await expect(service.reactiver('a-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
