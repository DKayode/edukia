import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  let plans: any;
  let service: PlansService;

  const plan = (surcharges: any = {}) => ({
    id: 1, uuid: 'p-1', pays: 'benin', code: 'MENSUEL', libelle: 'Abonnement mensuel',
    description: 'Accès illimité pendant 1 mois', avantages: null, prix: 2000,
    devise: 'XOF', duree_jours: 30, est_actif: false, ordre_affichage: 1,
    ...surcharges,
  });

  beforeEach(() => {
    plans = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(plan()),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn(async (p) => p),
    };
    service = new PlansService(plans);
  });

  describe('avantages', () => {
    it('enregistre la liste envoyée', async () => {
      // Le piège connu : un champ absent du DTO est écarté sans bruit par le
      // ValidationPipe, et la mise à jour paraît réussir sans rien changer.
      const avantages = ['Épreuves en illimité', 'Concours : téléchargement des sujets'];
      const r = await service.update('p-1', { avantages } as any);
      expect(plans.save).toHaveBeenCalledWith(expect.objectContaining({ avantages }));
      expect(r.avantages).toEqual(avantages);
    });

    it('accepte une liste vide — un plan peut n’avoir rien à annoncer', async () => {
      const r = await service.update('p-1', { avantages: [] } as any);
      expect(r.avantages).toEqual([]);
    });

    it('ne touche pas aux avantages quand la mise à jour ne les mentionne pas', async () => {
      plans.findOne.mockResolvedValue(plan({ avantages: ['Ketsia sans limite'] }));
      const r = await service.update('p-1', { prix: 2500 } as any);
      expect(r.avantages).toEqual(['Ketsia sans limite']);
      expect(r.prix).toBe(2500);
    });

    it('les porte à la création', async () => {
      // Aucun plan existant sous ce code, sinon la création est refusée.
      plans.findOne.mockResolvedValue(null);
      const r = await service.create('benin', {
        code: 'annuel', libelle: 'Annuel', prix: 15000, duree_jours: 365,
        avantages: ['Tout en illimité'],
      } as any);
      expect(r).toMatchObject({ code: 'ANNUEL', avantages: ['Tout en illimité'] });
    });
  });

  describe('catalogue', () => {
    it('le mobile ne voit que les plans ouverts', async () => {
      await service.findActifs('benin');
      expect(plans.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pays: 'benin', est_actif: true } }),
      );
    });

    it('l’administration les voit tous, fermés compris', async () => {
      await service.findAll('benin');
      expect(plans.find).toHaveBeenCalledWith(expect.objectContaining({ where: { pays: 'benin' } }));
    });
  });

  describe('garde-fous existants', () => {
    it('refuse un code déjà pris', async () => {
      await expect(
        service.create('benin', { code: 'MENSUEL', libelle: 'X', prix: 1, duree_jours: 1 } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse un plan introuvable', async () => {
      plans.findOne.mockResolvedValue(null);
      await expect(service.findByUuid('inconnu')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
