/**
 * Canonisation des libellés de niveau d'étude.
 *
 * Les référentiels sont alimentés par les utilisateurs — ils proposent un
 * niveau au moment de soumettre une épreuve, et l'administration le crée à
 * partir de ce texte. Chacun écrit à sa façon : la production compte
 * aujourd'hui « Licence 1 », « licence 1 » et « L1 » côte à côte, et une même
 * filière affiche parfois trois fois la même ligne dans sa liste déroulante.
 *
 * Plutôt que de nettoyer indéfiniment après coup, on ramène le libellé à sa
 * forme canonique À L'ÉCRITURE : quelqu'un qui saisit « l1 » crée « Licence 1 ».
 *
 * Ce qui n'est PAS reconnu est laissé tel quel, aux espaces près. Deviner
 * ferait plus de dégâts que de laisser passer : « Premier année » ressemble à
 * une Licence 1 sans l'être forcément, et « licence 2 et 3 » désigne deux
 * niveaux qu'on ne peut pas fusionner en un.
 */

/** Cycles dont la numérotation est sans ambiguïté. */
const CYCLES: { motif: RegExp; libelle: (n: string) => string }[] = [
  // l1, L 1, licence1, LICENCE 1, license 1 (faute courante) → Licence 1
  { motif: /^(?:l|licence|license)\s*([123])$/i, libelle: (n) => `Licence ${n}` },
  // m1, M 2, master2, MASTER 1 → Master 1
  { motif: /^(?:m|master|mastere|mastère)\s*([12])$/i, libelle: (n) => `Master ${n}` },
  // d1, doctorat 2 → Doctorat 2
  { motif: /^(?:d|doctorat)\s*([123])$/i, libelle: (n) => `Doctorat ${n}` },
];

/** Sigles du primaire, dont seule la casse varie. */
const SIGLES = new Set(['cp', 'ce1', 'ce2', 'cm1', 'cm2', 'bts', 'dut', 'deug']);

/**
 * Ramène un libellé à sa forme canonique.
 *
 * Toujours sûr : un libellé non reconnu ressort inchangé, espaces normalisés.
 */
export function canoniserNiveau(nom: string): string {
  // Espaces multiples, insécables et bordures : ils créent des doublons
  // invisibles à l'œil, « Licence 1 » et « Licence  1 » étant deux lignes.
  const propre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  if (!propre) return propre;

  for (const cycle of CYCLES) {
    const trouve = propre.match(cycle.motif);
    if (trouve) return cycle.libelle(trouve[1]);
  }

  if (SIGLES.has(propre.toLowerCase())) return propre.toUpperCase();

  return propre;
}

/**
 * Deux libellés désignent-ils le même niveau ?
 *
 * Sert à retrouver une ligne existante avant d'en créer une : la comparaison
 * se fait sur la forme canonique, insensible à la casse pour ce qui n'a pas pu
 * être canonisé.
 */
export function memeNiveau(a: string, b: string): boolean {
  return canoniserNiveau(a).toLowerCase() === canoniserNiveau(b).toLowerCase();
}
