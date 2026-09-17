import { NotFoundException } from '@nestjs/common';
import { FilieresService } from './filieres.service';

describe('FilieresService — non-duplication', () => {
  let filieres: any, etablissements: any, service: FilieresService;

  const enregistre = () => filieres.save.mock.calls[0][0];

  beforeEach(() => {
    filieres = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn(async (d) => ({ id: 1, ...d })),
    };
    etablissements = { findOne: jest.fn().mockResolvedValue({ id: 3, pays: 'benin' }) };
    // Le service passe par un résolveur de source de données.
    service = new FilieresService({
      getRepository: (e: any) => (e?.name === 'Etablissement' ? etablissements : filieres),
    } as any);
  });

  const creer = (nom: string) => service.create({ nom, etablissement_id: 3 } as any);

  it('normalise les espaces sans réécrire le libellé', async () => {
    await creer('  Sciences   Juridiques  ');
    expect(enregistre().nom).toBe('Sciences Juridiques');
  });

  it('hérite le pays de l’établissement, jamais de la requête', async () => {
    etablissements.findOne.mockResolvedValue({ id: 3, pays: 'senegal' });
    await creer('Droit Privé');
    expect(enregistre().pays).toBe('senegal');
  });

  it('rend la filière existante au lieu d’en créer une seconde', async () => {
    filieres.find.mockResolvedValue([{ id: 8, nom: 'Sciences Juridiques' }]);
    const r = await creer('sciences juridiques');
    expect(r).toMatchObject({ id: 8 });
    expect(filieres.save).not.toHaveBeenCalled();
  });

  it('crée bien une filière différente', async () => {
    filieres.find.mockResolvedValue([{ id: 8, nom: 'Droit Privé' }]);
    await creer('Droit Public');
    expect(enregistre().nom).toBe('Droit Public');
  });

  it('refuse un établissement inconnu', async () => {
    etablissements.findOne.mockResolvedValue(null);
    await expect(creer('Droit')).rejects.toBeInstanceOf(NotFoundException);
  });
});
