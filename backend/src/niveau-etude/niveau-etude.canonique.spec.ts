import { canoniserNiveau, memeNiveau } from './niveau-etude.canonique';

describe('canoniserNiveau', () => {
  describe('licences', () => {
    it.each([
      ['l1', 'Licence 1'],
      ['L1', 'Licence 1'],
      ['licence 1', 'Licence 1'],
      ['LICENCE 1', 'Licence 1'],
      ['Licence1', 'Licence 1'],
      ['L 2', 'Licence 2'],
      ['licence2', 'Licence 2'],
      ['L3', 'Licence 3'],
      ['licence 3', 'Licence 3'],
    ])('%s → %s', (saisi, attendu) => {
      expect(canoniserNiveau(saisi)).toBe(attendu);
    });

    it('corrige « license », la faute la plus fréquente', () => {
      // Relevé 2 fois dans les propositions de production, et 1 fois en base.
      expect(canoniserNiveau('license 2')).toBe('Licence 2');
    });
  });

  describe('masters et doctorats', () => {
    it.each([
      ['m1', 'Master 1'],
      ['M2', 'Master 2'],
      ['master 1', 'Master 1'],
      ['MASTER 2', 'Master 2'],
      ['mastère 1', 'Master 1'],
      ['d1', 'Doctorat 1'],
      ['doctorat 3', 'Doctorat 3'],
    ])('%s → %s', (saisi, attendu) => {
      expect(canoniserNiveau(saisi)).toBe(attendu);
    });
  });

  describe('sigles', () => {
    it.each([
      ['cm2', 'CM2'],
      ['Cm1', 'CM1'],
      ['bts', 'BTS'],
      ['ce2', 'CE2'],
    ])('%s → %s', (saisi, attendu) => {
      expect(canoniserNiveau(saisi)).toBe(attendu);
    });
  });

  describe('ce qui doit rester intact', () => {
    it.each([
      'Terminale',
      'Terminale S',
      'TS2',
      'DCEM III',
      'Ingénieur 2',
      'troisième',
    ])('laisse « %s » tel quel', (saisi) => {
      expect(canoniserNiveau(saisi)).toBe(saisi);
    });

    it('ne devine pas « Premier année »', () => {
      // Ressemble à une Licence 1 sans l'être forcément : un lycée ou une
      // école d'ingénieurs ont aussi une première année. Deviner ferait plus
      // de dégâts que de laisser passer.
      expect(canoniserNiveau('Premier année')).toBe('Premier année');
    });

    it('ne fusionne pas « licence 2 et 3 », qui désigne deux niveaux', () => {
      expect(canoniserNiveau('licence 2 et 3')).toBe('licence 2 et 3');
    });

    it('ne tranche pas « Master » seul, ambigu entre M1 et M2', () => {
      expect(canoniserNiveau('Master')).toBe('Master');
    });
  });

  describe('espaces', () => {
    it('normalise les espaces, qui créent des doublons invisibles', () => {
      // « Licence 1 » et « Licence  1 » s'affichent pareil et font deux lignes.
      expect(canoniserNiveau('  Licence   3  ')).toBe('Licence 3');
      expect(canoniserNiveau('Licence 1')).toBe('Licence 1');
    });

    it('supporte une saisie vide sans lever', () => {
      expect(canoniserNiveau('')).toBe('');
      expect(canoniserNiveau(null as any)).toBe('');
      expect(canoniserNiveau(undefined as any)).toBe('');
    });
  });
});

describe('memeNiveau', () => {
  it('rapproche les variantes d’un même niveau', () => {
    expect(memeNiveau('L1', 'licence 1')).toBe(true);
    expect(memeNiveau('license 2', 'Licence 2')).toBe(true);
    expect(memeNiveau('master 1', 'M1')).toBe(true);
  });

  it('distingue des niveaux réellement différents', () => {
    expect(memeNiveau('Licence 1', 'Licence 2')).toBe(false);
    expect(memeNiveau('Master 1', 'Licence 1')).toBe(false);
    expect(memeNiveau('Terminale S', 'Terminale L')).toBe(false);
  });

  it('reste insensible à la casse sur ce qui n’a pas pu être canonisé', () => {
    expect(memeNiveau('terminale', 'Terminale')).toBe(true);
  });
});
