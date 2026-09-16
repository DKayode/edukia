import { NotFoundException } from '@nestjs/common';
import { MatieresService } from './matieres.service';

/**
 * La création d'une matière est le point d'entrée d'un professeur, et la
 * reprise d'une matière proposée par un utilisateur. Rien n'empêchait d'y
 * insérer deux fois la même : 125 lignes strictement identiques en production.
 */
describe('MatieresService — non-duplication', () => {
  let matieres: any, niveaux: any, service: MatieresService;

  const enregistre = () => matieres.save.mock.calls[0][0];

  beforeEach(() => {
    matieres = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn(async (d) => ({ id: 1, ...d })),
    };
    niveaux = { findOne: jest.fn().mockResolvedValue({ id: 5, pays: 'benin' }) };
    service = new MatieresService(matieres, niveaux);
  });

  const creer = (nom: string) => service.create('benin', { nom, niveau_etude_id: 5 } as any);

  describe('création', () => {
    it('normalise les espaces sans toucher au libellé', () => {
      return creer('  Optique   Physique  ').then(() => {
        expect(enregistre().nom).toBe('Optique Physique');
      });
    });

    it('conserve la casse et les accents — pas de nomenclature à imposer', async () => {
      await creer('Algèbre Linéaire');
      expect(enregistre().nom).toBe('Algèbre Linéaire');
    });

    it('hérite le pays du niveau, pas de la requête', async () => {
      niveaux.findOne.mockResolvedValue({ id: 5, pays: 'senegal' });
      await creer('Anglais');
      expect(enregistre().pays).toBe('senegal');
    });

    it('refuse un niveau inconnu', async () => {
      niveaux.findOne.mockResolvedValue(null);
      await expect(creer('Anglais')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('réutilisation', () => {
    it('rend la ligne existante sur un libellé identique', async () => {
      matieres.find.mockResolvedValue([{ id: 9, nom: 'Macroéconomie', niveau_etude_id: 5 }]);
      const r = await creer('Macroéconomie');
      expect(r).toMatchObject({ id: 9 });
      expect(matieres.save).not.toHaveBeenCalled();
    });

    it('rapproche une variante de casse', async () => {
      // Cas réel : « Optique Physique » et « Optique physique » coexistaient.
      matieres.find.mockResolvedValue([{ id: 9, nom: 'Optique Physique', niveau_etude_id: 5 }]);
      await creer('optique physique');
      expect(matieres.save).not.toHaveBeenCalled();
    });

    it('rapproche une variante d’accent', async () => {
      matieres.find.mockResolvedValue([{ id: 9, nom: 'Algèbre linéaire', niveau_etude_id: 5 }]);
      await creer('Algebre lineaire');
      expect(matieres.save).not.toHaveBeenCalled();
    });

    it('crée bien une matière réellement différente', async () => {
      matieres.find.mockResolvedValue([{ id: 9, nom: 'Microéconomie', niveau_etude_id: 5 }]);
      await creer('Macroéconomie');
      expect(enregistre().nom).toBe('Macroéconomie');
    });

    it('ne regarde que le niveau visé', async () => {
      await creer('Anglais');
      expect(matieres.find).toHaveBeenCalledWith({ where: { niveau_etude_id: 5 } });
    });
  });
});
