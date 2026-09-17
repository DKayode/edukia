/**
 * Comparaison des libellés de référentiel saisis librement.
 *
 * Les matières et les filières sont créées par les utilisateurs — un
 * professeur ajoute une matière, quelqu'un propose une filière en soumettant
 * une épreuve. Rien n'empêchait jusqu'ici d'insérer deux fois la même : la
 * production compte 125 lignes de matières strictement identiques sous un même
 * niveau, et 8 filières en double sous un même établissement.
 *
 * Contrairement aux niveaux d'étude, ces libellés n'ont PAS de nomenclature
 * fermée : « Macroéconomie » ne se réécrit pas comme « l1 » devient
 * « Licence 1 ». On se contente donc de normaliser les espaces et de comparer
 * sans tenir compte de la casse ni des accents — assez pour reconnaître un
 * doublon, jamais assez pour réécrire ce que l'utilisateur a voulu dire.
 */

/**
 * Nettoie un libellé sans en changer le sens.
 *
 * Les espaces multiples et les bordures créent des doublons invisibles à
 * l'œil : « Algèbre 1 » et « Algèbre  1 » s'affichent pareil et font deux
 * lignes.
 */
export function normaliserLibelle(nom: string): string {
  return String(nom ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Forme de comparaison : sans casse, sans accents, espaces normalisés.
 *
 * Sert uniquement à retrouver un doublon. Le libellé stocké reste celui que
 * l'utilisateur a saisi — « Algèbre linéaire » ne devient jamais
 * « algebre lineaire ».
 */
export function clefLibelle(nom: string): string {
  return normaliserLibelle(nom)
    .toLowerCase()
    .normalize('NFD')
    // Retire les diacritiques : « Algèbre » et « Algebre » sont la même matière.
    .replace(/[̀-ͯ]/g, '');
}

/** Deux libellés désignent-ils la même chose ? */
export function memeLibelle(a: string, b: string): boolean {
  return clefLibelle(a) === clefLibelle(b);
}
