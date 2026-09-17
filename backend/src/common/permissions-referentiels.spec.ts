import { Reflector } from '@nestjs/core';
import { EtablissementsController } from '../etablissements/etablissements.controller';
import { FilieresController } from '../filieres/filieres.controller';
import { MatieresController } from '../matieres/matieres.controller';
import { NiveauEtudeController } from '../niveau-etude/niveau-etude.controller';

/**
 * Les quatre référentiels — établissement, filière, niveau, matière — servent
 * le MÊME parcours : les choisir l'un après l'autre pour déposer une épreuve.
 * Leurs permissions doivent donc suivre la même règle, sans quoi l'application
 * bute sur un 403 au milieu du tunnel, sans rien pour l'expliquer.
 *
 * Ce test verrouille l'invariant plutôt que chaque route : lecture ouverte à
 * tout compte connecté, écriture réservée.
 */
describe('Permissions des référentiels', () => {
  const reflector = new Reflector();

  const roles = (controleur: any, methode: string): string[] | undefined =>
    reflector.get('roles', controleur.prototype[methode]);

  const LECTURES: [string, any, string[]][] = [
    ['niveau-etude', NiveauEtudeController, ['findAll', 'findGroupByName', 'findOne']],
    ['filieres', FilieresController, ['findAll', 'findOne']],
    ['matieres', MatieresController, ['findAll', 'findOne']],
    ['etablissements', EtablissementsController, ['findAll', 'findOne']],
  ];

  describe.each(LECTURES)('%s — lecture', (_nom, controleur, methodes) => {
    it.each(methodes)('%s est ouverte à tout compte connecté', (methode) => {
      // Un étudiant doit pouvoir lister ce qu'il va sélectionner. Restreindre
      // la lecture aux admins produisait le 403 observé sur mobile.
      expect(roles(controleur, methode)).toBeUndefined();
    });
  });

  const ECRITURES: [string, any, string[]][] = [
    ['niveau-etude', NiveauEtudeController, ['create', 'update', 'remove']],
    ['filieres', FilieresController, ['create', 'update', 'remove']],
    ['etablissements', EtablissementsController, ['create', 'update', 'remove']],
  ];

  describe.each(ECRITURES)('%s — écriture', (_nom, controleur, methodes) => {
    it.each(methodes)('%s reste réservée', (methode) => {
      // `update` et `remove` acceptaient tout compte connecté : un étudiant
      // pouvait renommer ou supprimer un niveau, et avec lui les matières et
      // épreuves qui en dépendent.
      const r = roles(controleur, methode);
      expect(r).toBeDefined();
      expect(r).toContain('admin');
    });
  });

  it('les matières restent modifiables par un professeur', () => {
    // Exception assumée : ce sont eux qui alimentent le catalogue.
    for (const methode of ['create', 'update', 'remove']) {
      const r = roles(MatieresController, methode);
      expect(r).toBeDefined();
      expect(r).toEqual(expect.arrayContaining(['admin', 'professeur']));
    }
  });
});
