import { clefLibelle, memeLibelle, normaliserLibelle } from './libelles';

describe('normaliserLibelle', () => {
  it('réduit les espaces multiples et les bordures', () => {
    // « Algèbre 1 » et « Algèbre  1 » s'affichent pareil et font deux lignes.
    expect(normaliserLibelle('  Optique   Physique  ')).toBe('Optique Physique');
  });

  it('ne touche NI à la casse NI aux accents', () => {
    // Une matière n'a pas de nomenclature fermée : on ne réécrit pas ce que
    // l'utilisateur a voulu dire, contrairement aux niveaux d'étude.
    expect(normaliserLibelle('Algèbre Linéaire')).toBe('Algèbre Linéaire');
  });

  it('supporte une entrée vide sans lever', () => {
    expect(normaliserLibelle('')).toBe('');
    expect(normaliserLibelle(null as any)).toBe('');
    expect(normaliserLibelle(undefined as any)).toBe('');
  });
});

describe('memeLibelle', () => {
  it('rapproche deux graphies du même libellé', () => {
    // Les 4 groupes réellement observés en production ne diffèrent que par la casse.
    expect(memeLibelle('Optique Physique', 'Optique physique')).toBe(true);
    expect(memeLibelle('Architecture des Ordinateurs', 'architecture des ordinateurs')).toBe(true);
  });

  it('ignore les accents', () => {
    expect(memeLibelle('Algèbre linéaire', 'Algebre lineaire')).toBe(true);
    expect(memeLibelle('Économie', 'economie')).toBe(true);
  });

  it('ignore les espaces surnuméraires', () => {
    expect(memeLibelle('Macro   économie', ' Macro économie ')).toBe(true);
  });

  it('distingue deux matières réellement différentes', () => {
    expect(memeLibelle('Anglais', 'Français')).toBe(false);
    expect(memeLibelle('Algèbre 1', 'Algèbre 2')).toBe(false);
    expect(memeLibelle('Microéconomie', 'Macroéconomie')).toBe(false);
  });
});

describe('clefLibelle', () => {
  it('produit une forme de comparaison, jamais destinée au stockage', () => {
    expect(clefLibelle('Algèbre Linéaire')).toBe('algebre lineaire');
  });
});
