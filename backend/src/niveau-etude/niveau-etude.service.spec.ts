import { NotFoundException } from '@nestjs/common';
import { NiveauEtudeService } from './niveau-etude.service';

/**
 * Le point d'entrée unique par lequel un niveau entre en base — que la saisie
 * vienne du back-office ou de la résolution d'une proposition d'utilisateur.
 */
describe('NiveauEtudeService — canonisation à l’écriture', () => {
  let niveaux: any, filieres: any, service: NiveauEtudeService;

  const enregistre = () => niveaux.save.mock.calls[0][0];

  beforeEach(() => {
    niveaux = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn(async (d) => ({ id: 1, ...d })),
    };
    filieres = { findOne: jest.fn().mockResolvedValue({ id: 10, pays: 'benin' }) };
    service = new NiveauEtudeService(niveaux, filieres);
  });

  const creer = (nom: string) => service.create('benin', { nom, filiere_id: 10 } as any);

  describe('création', () => {
    it('enregistre « Licence 1 » quand l’utilisateur a saisi « L1 »', async () => {
      await creer('L1');
      expect(enregistre().nom).toBe('Licence 1');
    });

    it('corrige la casse d’une saisie courante', async () => {
      await creer('licence 2');
      expect(enregistre().nom).toBe('Licence 2');
    });

    it('corrige la faute « license »', async () => {
      await creer('license 2');
      expect(enregistre().nom).toBe('Licence 2');
    });

    it('laisse intact un libellé hors nomenclature', async () => {
      await creer('Terminale S');
      expect(enregistre().nom).toBe('Terminale S');
    });

    it('hérite le pays de la filière, pas de la requête', async () => {
      filieres.findOne.mockResolvedValue({ id: 10, pays: 'senegal' });
      await creer('M1');
      expect(enregistre()).toMatchObject({ nom: 'Master 1', pays: 'senegal' });
    });

    it('refuse une filière inconnue', async () => {
      filieres.findOne.mockResolvedValue(null);
      await expect(creer('L1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('non-duplication', () => {
    it('réutilise la ligne existante au lieu d’en créer une variante', async () => {
      // C'est ce qui produisait « Licence 1 » en triple dans la même liste
      // déroulante : trois saisies différentes, trois lignes.
      niveaux.find.mockResolvedValue([{ id: 7, nom: 'Licence 1', filiere_id: 10 }]);
      const r = await creer('l1');
      expect(r).toMatchObject({ id: 7, nom: 'Licence 1' });
      expect(niveaux.save).not.toHaveBeenCalled();
    });

    it('réutilise aussi sur une correspondance stricte', async () => {
      niveaux.find.mockResolvedValue([{ id: 7, nom: 'Licence 1', filiere_id: 10 }]);
      await creer('Licence 1');
      expect(niveaux.save).not.toHaveBeenCalled();
    });

    it('crée bien un niveau réellement différent', async () => {
      niveaux.find.mockResolvedValue([{ id: 7, nom: 'Licence 1', filiere_id: 10 }]);
      await creer('Licence 2');
      expect(enregistre().nom).toBe('Licence 2');
    });

    it('ne regarde que la filière visée', async () => {
      await creer('L1');
      expect(niveaux.find).toHaveBeenCalledWith({ where: { filiere_id: 10 } });
    });
  });

  describe('mise à jour', () => {
    it('canonise aussi un renommage', async () => {
      // Sans quoi le back-office rouvrirait la porte qu'on vient de fermer.
      niveaux.findOne.mockResolvedValue({ id: 7, nom: 'Licence 1', filiere_id: 10, pays: 'benin' });
      await service.update('7', { nom: 'l1' } as any);
      expect(niveaux.save).toHaveBeenCalledWith(expect.objectContaining({ nom: 'Licence 1' }));
    });

    it('conserve le libellé quand la mise à jour ne le mentionne pas', async () => {
      niveaux.findOne.mockResolvedValue({ id: 7, nom: 'Licence 1', filiere_id: 10, pays: 'benin' });
      await service.update('7', { duree_mois: 12 } as any);
      expect(niveaux.save).toHaveBeenCalledWith(expect.objectContaining({ nom: 'Licence 1' }));
    });
  });
});
