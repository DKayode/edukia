import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigurationProfil } from './entities/configuration-profil.entity';
import { Utilisateur } from './entities/utilisateur.entity';

/**
 * Champs qui comptent dans la complétion, et leur libellé pour l'utilisateur.
 *
 * `situation_handicap` est ABSENT à dessein : sa colonne porte `DEFAULT false`,
 * elle n'est donc jamais vide. La compter donnerait à tout le monde des points
 * gratuits — un pourcentage qui monte sans que l'utilisateur ait rien fait ne
 * mesure pas la complétion.
 */
export const CHAMPS_PROFIL: { champ: string; libelle: string }[] = [
  { champ: 'nom', libelle: 'Nom' },
  { champ: 'prenom', libelle: 'Prénom' },
  { champ: 'sexe', libelle: 'Sexe' },
  { champ: 'pseudo', libelle: 'Pseudo' },
  { champ: 'telephone', libelle: 'Numéro de téléphone' },
  { champ: 'photo', libelle: 'Photo de profil' },
  { champ: 'age_group', libelle: 'Tranche d’âge' },
  { champ: 'zone_residence', libelle: 'Zone de résidence' },
  { champ: 'departement_id', libelle: 'Département' },
  { champ: 'ville_id', libelle: 'Ville' },
  { champ: 'etablissement_id', libelle: 'Établissement' },
  { champ: 'filiere_id', libelle: 'Filière' },
  { champ: 'niveau_etude_id', libelle: 'Niveau d’étude' },
  { champ: 'type_profil_id', libelle: 'Type de profil' },
  // La situation de handicap est délibérément absente : sa colonne porte
  // DEFAULT false, elle n'est donc jamais vide et vaudrait un point acquis
  // d'avance pour tout le monde. La compter n'apprendrait rien.
  // L'adresse et sa vérification ne font qu'un champ : sans adresse il n'y a
  // pas de compte, donc la compter à part reviendrait à créditer tout le monde
  // d'un point acquis d'avance. Seule la vérification distingue les profils.
  { champ: 'email_verifie', libelle: 'Adresse email vérifiée' },
];

export interface Completion {
  pourcentage: number;
  champs_total: number;
  champs_remplis: number;
  seuil_requis: number;
  seuil_actif: boolean;
  /** `true` quand le seuil est inactif : le client n'a pas à connaître la règle. */
  conforme: boolean;
  manquants: { champ: string; libelle: string }[];
}

@Injectable()
export class ProfilCompletionService {
  private readonly logger = new Logger(ProfilCompletionService.name);

  constructor(
    @InjectRepository(Utilisateur) private readonly utilisateurs: Repository<Utilisateur>,
    @InjectRepository(ConfigurationProfil) private readonly configurations: Repository<ConfigurationProfil>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async reglage(pays = 'benin') {
    const config = await this.configurations.findOne({ where: { pays } });
    return {
      seuil: config?.seuil_completion ?? 95,
      estActif: config?.est_actif ?? false,
      champsExclus: config?.champs_exclus ?? [],
      uuid: config?.uuid,
    };
  }

  async reglages(pays = 'benin') {
    const [r, taux] = await Promise.all([this.reglage(pays), this.tauxParChamp(pays)]);
    return {
      uuid: r.uuid,
      pays,
      seuil_completion: r.seuil,
      est_actif: r.estActif,
      champs_exclus: r.champsExclus,
      champs_disponibles: taux,
    };
  }

  async modifierReglage(
    pays: string,
    champs: { seuil_completion?: number; est_actif?: boolean; champs_exclus?: string[] },
  ) {
    // La ligne est créée à la première écriture. La migration n'en a semé
    // qu'une, pour le Bénin : exiger qu'elle existe rendait la page
    // inutilisable pour tout autre pays — la lecture se repliait sur les
    // valeurs par défaut, l'écriture échouait en « introuvable ». Le pays a
    // déjà été validé par CountryMiddleware, qui refuse les inconnus.
    const config =
      (await this.configurations.findOne({ where: { pays } })) ??
      this.configurations.create({ pays, seuil_completion: 95, est_actif: false });
    Object.assign(config, {
      ...(champs.seuil_completion !== undefined ? { seuil_completion: champs.seuil_completion } : {}),
      ...(champs.est_actif !== undefined ? { est_actif: champs.est_actif } : {}),
      ...(champs.champs_exclus !== undefined ? { champs_exclus: champs.champs_exclus?.length ? champs.champs_exclus : null } : {}),
    });
    await this.configurations.save(config);
    this.logger.log(`Seuil de complétion ${pays} : ${config.seuil_completion}% actif=${config.est_actif}`);
    return this.reglages(pays);
  }

  /** Champs retenus après exclusions. */
  private champsRetenus(exclus: string[]) {
    return CHAMPS_PROFIL.filter((c) => !exclus.includes(c.champ));
  }

  /**
   * « Ce champ est-il rempli ? », en SQL. Doit rester le miroir exact de
   * `estRempli` : deux définitions divergentes donneraient un pourcentage
   * individuel et un agrégat qui ne se recoupent pas, sans que rien ne le
   * signale.
   */
  private static sqlRempli(champ: string): string {
    if (champ === 'photo') {
      return `(CASE WHEN COALESCE(NULLIF(TRIM(profil_photo_path), ''), NULLIF(TRIM(photo), '')) IS NOT NULL THEN 1 ELSE 0 END)`;
    }
    if (champ === 'email_verifie') return `(CASE WHEN verifier THEN 1 ELSE 0 END)`;
    if (['departement_id', 'ville_id', 'etablissement_id', 'filiere_id', 'niveau_etude_id', 'type_profil_id', 'sexe', 'age_group'].includes(champ)) {
      return `(CASE WHEN ${champ} IS NOT NULL THEN 1 ELSE 0 END)`;
    }
    return `(CASE WHEN NULLIF(TRIM(${champ}), '') IS NOT NULL THEN 1 ELSE 0 END)`;
  }

  /**
   * Combien de comptes ont réellement rempli chaque champ.
   *
   * Sans ce chiffre, exclure un champ du calcul se fait à l'aveugle : rien ne
   * distingue celui que personne ne renseigne — et qui bloque donc tout le
   * monde — de celui qui ne coûte rien à exiger.
   */
  async tauxParChamp(pays = 'benin') {
    const colonnes = CHAMPS_PROFIL
      .map((c, i) => `SUM(${ProfilCompletionService.sqlRempli(c.champ)})::int AS c${i}`)
      .join(', ');
    const [ligne] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total, ${colonnes}
         FROM utilisateurs WHERE pays = $1 AND est_desactive = false`,
      [pays],
    );
    const total = Number(ligne.total ?? 0);
    return CHAMPS_PROFIL.map((c, i) => {
      const remplis = Number(ligne[`c${i}`] ?? 0);
      return {
        ...c,
        remplis,
        part: total ? Math.round((remplis * 1000) / total) / 10 : 0,
      };
    });
  }

  /**
   * Un champ est rempli s'il porte une valeur exploitable.
   *
   * Les chaînes vides comptent pour vides : `profil_photo_path` vaut `''` par
   * défaut, pas `NULL`, et le traiter comme rempli créditerait une photo que
   * personne n'a envoyée.
   */
  private estRempli(user: any, champ: string): boolean {
    switch (champ) {
      case 'photo':
        return !!(user.profil_photo_path?.trim() || user.photo?.trim());
      case 'email_verifie':
        return user.verifier === true;
      default: {
        const v = user[champ];
        return v !== null && v !== undefined && String(v).trim() !== '';
      }
    }
  }

  async pourUtilisateur(utilisateurId: number, pays = 'benin'): Promise<Completion> {
    const user = await this.utilisateurs.findOne({
      where: { id: utilisateurId },
      select: [
        'id', 'nom', 'prenom', 'email', 'sexe', 'pseudo', 'telephone', 'photo',
        'profil_photo_path', 'age_group', 'zone_residence', 'departement_id', 'ville_id',
        'etablissement_id', 'filiere_id', 'niveau_etude_id', 'type_profil_id', 'verifier',
      ] as any,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const { seuil, estActif, champsExclus } = await this.reglage(pays);
    const champs = this.champsRetenus(champsExclus);
    const manquants = champs.filter((c) => !this.estRempli(user, c.champ));
    const remplis = champs.length - manquants.length;
    const pourcentage = champs.length ? Math.round((remplis * 100) / champs.length) : 100;

    return {
      pourcentage,
      champs_total: champs.length,
      champs_remplis: remplis,
      seuil_requis: seuil,
      seuil_actif: estActif,
      // Seuil inactif = tout le monde est conforme : le client n'a pas à
      // connaître la règle d'activation pour afficher le bon écran.
      conforme: !estActif || pourcentage >= seuil,
      manquants,
    };
  }

  /** Version légère pour le contrôle de droits — pas de liste de champs à construire. */
  async estConforme(utilisateurId: number, pays = 'benin'): Promise<{ conforme: boolean; pourcentage: number; seuil: number; actif: boolean }> {
    const { seuil, estActif } = await this.reglage(pays);
    if (!estActif) return { conforme: true, pourcentage: 100, seuil, actif: false };
    const c = await this.pourUtilisateur(utilisateurId, pays);
    return { conforme: c.conforme, pourcentage: c.pourcentage, seuil, actif: true };
  }

  /**
   * Combien de comptes passeraient à chaque seuil.
   *
   * Affiché au moment du réglage : sans ce chiffre, rien n'empêche de fixer
   * 95 % et de couper le service à des dizaines de milliers de personnes.
   */
  async distribution(pays = 'benin') {
    const { champsExclus } = await this.reglage(pays);
    const champs = this.champsRetenus(champsExclus);

    const expression = champs.map((c) => ProfilCompletionService.sqlRempli(c.champ)).join(' + ');

    const lignes = await this.dataSource.query(
      `WITH score AS (
         SELECT ROUND(100.0 * (${expression}) / ${champs.length}) AS pct
           FROM utilisateurs WHERE pays = $1 AND est_desactive = false
       )
       SELECT pct::int AS pourcentage, COUNT(*)::int AS comptes
         FROM score GROUP BY pct ORDER BY pct`,
      [pays],
    );

    const total = lignes.reduce((n: number, l: any) => n + Number(l.comptes), 0);
    const auMoins = (seuil: number) =>
      lignes.filter((l: any) => Number(l.pourcentage) >= seuil).reduce((n: number, l: any) => n + Number(l.comptes), 0);

    return {
      total,
      champs_comptes: champs.length,
      repartition: lignes.map((l: any) => ({ pourcentage: Number(l.pourcentage), comptes: Number(l.comptes) })),
      // Les paliers usuels, pour choisir un seuil en connaissance de cause.
      passeraient: [50, 60, 70, 80, 90, 95, 100].map((seuil) => ({
        seuil,
        comptes: auMoins(seuil),
        part: total ? Math.round((auMoins(seuil) * 1000) / total) / 10 : 0,
      })),
    };
  }
}
