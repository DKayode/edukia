import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CodeUtilisation } from './entities/code-utilisation.entity';
import {
  Effet,
  ParametresAbonnementOffert,
  ParametresCommission,
  ParametresReduction,
  TypeRemise,
} from './entities/code-effet.entity';
import { Code, OrigineCode } from './entities/code.entity';

export type MotifRefus =
  | 'INTROUVABLE'
  | 'INACTIF'
  | 'PAS_ENCORE_VALIDE'
  | 'EXPIRE'
  | 'QUOTA_TOTAL_ATTEINT'
  | 'DEJA_UTILISE'
  | 'PLAN_NON_ELIGIBLE'
  | 'AUTO_UTILISATION';

export interface Remise {
  type: TypeRemise;
  valeur: number;
  montant_remise: number;
  prix_initial: number;
  prix_final: number;
}

/** Ce que le code produit concrètement pour cet achat. */
export interface EffetsAppliques {
  remise?: Remise;
  /** Bénéficiaire de la commission, si le code en porte une et a un propriétaire. */
  commission_pour?: number;
  /** L'abonnement est offert : aucun encaissement, aucune commission. */
  abonnement_offert?: { duree_jours?: number };
}

export interface ResultatValidation {
  valide: boolean;
  motif?: MotifRefus;
  code?: {
    id: number;
    uuid: string;
    code: string;
    origine: OrigineCode;
    libelle?: string | null;
    proprietaire_id: number | null;
    effets: Effet[];
  };
  effets?: EffetsAppliques;
}

@Injectable()
export class CodeValidationService {
  private readonly logger = new Logger(CodeValidationService.name);

  constructor(
    @InjectRepository(Code) private readonly codes: Repository<Code>,
    @InjectRepository(CodeUtilisation) private readonly utilisations: Repository<CodeUtilisation>,
  ) {}

  /** Normalisation unique : la casse et les espaces ne départagent jamais deux codes. */
  static normaliser(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Combinaisons interdites.
   *
   * Un abonnement offert n'est pas encaissé : une remise ne s'applique à rien, et
   * une commission prélèverait une part d'un montant nul. Laisser créer un tel
   * code produirait un comportement que personne ne saurait expliquer.
   */
  static verifierCoherence(effets: Effet[]): void {
    const a = new Set(effets);
    if (a.has(Effet.ABONNEMENT_OFFERT) && a.has(Effet.REDUCTION)) {
      throw new BadRequestException(
        'Un abonnement offert n’est pas payé : une réduction ne s’y applique pas.',
      );
    }
    if (a.has(Effet.ABONNEMENT_OFFERT) && a.has(Effet.COMMISSION)) {
      throw new BadRequestException(
        'Un abonnement offert n’encaisse rien : aucune commission ne peut en être tirée.',
      );
    }
  }

  async trouver(code: string, pays?: string): Promise<Code | null> {
    const qb = this.codes
      .createQueryBuilder('code')
      .leftJoinAndSelect('code.effets', 'effets')
      .where('upper(code.code) = :code', { code: CodeValidationService.normaliser(code) });
    if (pays) qb.andWhere('code.pays = :pays', { pays });
    return qb.getOne();
  }

  /**
   * Vérifie un code SANS le consommer — pour l'aperçu avant paiement.
   *
   * La validation est refaite sous verrou au moment de consommer : entre
   * l'aperçu et l'achat, un autre acheteur peut avoir pris la dernière place.
   */
  async valider(
    codeSaisi: string,
    /**
     * Absent pour un appel anonyme — un code se saisit souvent avant
     * l'inscription. Deux refus deviennent alors indétectables : l'usage de son
     * propre code et un code déjà consommé par ce compte. Sans conséquence, la
     * souscription revalidant tout sous verrou, et elle exige un compte.
     */
    utilisateurId: number | undefined,
    contexte: { planId?: number; prix?: number; pays?: string } = {},
  ): Promise<ResultatValidation> {
    const code = await this.trouver(codeSaisi, contexte.pays);
    if (!code) return { valide: false, motif: 'INTROUVABLE' };

    const motif = await this.motifDeRefus(code, utilisateurId, contexte.planId);
    const resume = {
      id: code.id,
      uuid: code.uuid,
      code: code.code,
      origine: code.origine,
      libelle: code.libelle,
      proprietaire_id: code.proprietaire_id,
      effets: (code.effets ?? []).map((e) => e.effet),
    };
    if (motif) return { valide: false, motif, code: resume };

    return { valide: true, code: resume, effets: this.calculerEffets(code, utilisateurId, contexte.prix) };
  }

  /**
   * Traduit les effets déclarés en conséquences concrètes pour cet achat.
   *
   * Le calcul vit ici, et pas chez l'appelant, pour qu'aperçu et souscription
   * ne puissent pas diverger.
   */
  calculerEffets(code: Code, utilisateurId: number | undefined, prix?: number): EffetsAppliques {
    const applique: EffetsAppliques = {};

    for (const e of code.effets ?? []) {
      switch (e.effet) {
        case Effet.REDUCTION: {
          if (prix === undefined) break;
          const p = (e.parametres ?? {}) as ParametresReduction;
          if (!p.type || p.valeur == null) break;
          applique.remise = this.calculerRemise(p, prix);
          break;
        }
        case Effet.COMMISSION: {
          // Sans propriétaire, personne à payer. S'auto-payer n'a aucun sens.
          if (!code.proprietaire_id || code.proprietaire_id === utilisateurId) break;
          const p = (e.parametres ?? {}) as ParametresCommission;
          applique.commission_pour = code.proprietaire_id;
          if (p.taux != null) (applique as any).commission_taux = p.taux;
          break;
        }
        case Effet.ABONNEMENT_OFFERT: {
          const p = (e.parametres ?? {}) as ParametresAbonnementOffert;
          applique.abonnement_offert = { duree_jours: p.duree_jours };
          break;
        }
      }
    }
    return applique;
  }

  /**
   * Montant d'une remise.
   *
   * Arrondi à l'entier : le XOF n'a pas de subdivision. Plafonné au prix — un
   * code « −5 000 » sur un plan à 2 000 rend l'abonnement gratuit, il ne crée
   * pas une créance.
   */
  calculerRemise(p: ParametresReduction, prix: number): Remise {
    const brut =
      p.type === TypeRemise.POURCENTAGE
        ? Math.round((prix * Number(p.valeur)) / 100)
        : Math.round(Number(p.valeur));
    const montant = Math.min(Math.max(brut, 0), prix);
    return { type: p.type, valeur: Number(p.valeur), montant_remise: montant, prix_initial: prix, prix_final: prix - montant };
  }

  /**
   * Prend le verrou sur le code et revérifie sous verrou.
   *
   * ⚠️ **À appeler AVANT d'insérer la ligne qui référence le code.** Insérer
   * d'abord prend un `FOR KEY SHARE` sur la ligne de `codes` via la clé
   * étrangère ; tenter ensuite de l'élever en `FOR UPDATE` produit un
   * INTERBLOCAGE dès que deux acheteurs arrivent en même temps — observé, puis
   * corrigé par cet ordre.
   */
  async verrouillerEtValider(
    manager: EntityManager,
    codeId: number,
    utilisateurId: number,
  ): Promise<{ ok: boolean; motif?: MotifRefus; pays?: string }> {
    const [code] = await manager.query(`SELECT * FROM codes WHERE id = $1 FOR UPDATE`, [codeId]);
    if (!code) return { ok: false, motif: 'INTROUVABLE' };

    const motif = await this.motifDeRefus(code as Code, utilisateurId, undefined, manager);
    if (motif) return { ok: false, motif };
    return { ok: true, pays: code.pays };
  }

  /** Enregistre l'utilisation, une fois la ligne référençante créée. */
  async enregistrerUtilisation(
    manager: EntityManager,
    codeId: number,
    utilisateurId: number,
    params: { abonnementId?: number; montantRemise?: number; pays?: string; effets?: EffetsAppliques },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO codes_utilisations (pays, code_id, utilisateur_id, abonnement_id, montant_remise, effets_appliques)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.pays ?? 'benin', codeId, utilisateurId,
        params.abonnementId ?? null, params.montantRemise ?? 0,
        params.effets ? JSON.stringify(params.effets) : null,
      ],
    );
    await manager.query(`UPDATE codes SET usage_actuel = usage_actuel + 1 WHERE id = $1`, [codeId]);
  }

  /**
   * Libère une utilisation liée à un abonnement.
   *
   * Sans cela, un paiement abandonné viderait le code : les places d'une
   * campagne limitée partiraient en paniers jamais payés.
   */
  async libererPourAbonnement(abonnementId: number, manager?: EntityManager): Promise<number> {
    const repo = manager ? manager.getRepository(CodeUtilisation) : this.utilisations;
    const lignes = await repo.find({ where: { abonnement_id: abonnementId } });
    if (!lignes.length) return 0;

    for (const ligne of lignes) {
      await repo.delete(ligne.id);
      const requete = `UPDATE codes SET usage_actuel = GREATEST(usage_actuel - 1, 0) WHERE id = $1`;
      manager ? await manager.query(requete, [ligne.code_id]) : await this.codes.query(requete, [ligne.code_id]);
    }
    this.logger.log(`${lignes.length} utilisation(s) de code libérée(s) pour l'abonnement ${abonnementId}`);
    return lignes.length;
  }

  private async motifDeRefus(
    code: Code,
    utilisateurId: number | undefined,
    planId?: number,
    manager?: EntityManager,
  ): Promise<MotifRefus | null> {
    if (!code.est_actif) return 'INACTIF';

    const maintenant = new Date();
    if (code.date_debut && new Date(code.date_debut) > maintenant) return 'PAS_ENCORE_VALIDE';
    if (code.date_fin && new Date(code.date_fin) < maintenant) return 'EXPIRE';

    // Utiliser son propre code n'a aucun sens : ni remise offerte à soi-même,
    // ni commission versée à soi-même. Indécidable sans compte.
    if (utilisateurId && code.proprietaire_id === utilisateurId) return 'AUTO_UTILISATION';

    const plans = (code as any).plans_eligibles as number[] | null;
    if (planId && plans?.length && !plans.includes(planId)) return 'PLAN_NON_ELIGIBLE';

    // Les compteurs se lisent sur le JOURNAL, pas sur `usage_actuel` : ce dernier
    // est un cache, et un écart ne doit pas laisser passer une place de trop.
    const compter = async (where: string, valeurs: any[]) => {
      const requete = `SELECT COUNT(*)::int AS n FROM codes_utilisations WHERE ${where}`;
      const [r] = manager ? await manager.query(requete, valeurs) : await this.utilisations.query(requete, valeurs);
      return Number(r?.n ?? 0);
    };

    if (code.usage_max_total != null) {
      if ((await compter('code_id = $1', [code.id])) >= code.usage_max_total) return 'QUOTA_TOTAL_ATTEINT';
    }

    // Le plafond par personne suppose qu'on sache de qui il s'agit. Un appel
    // anonyme y échappe donc — écrit ici explicitement plutôt que laissé à
    // `utilisateur_id = NULL`, qui ne correspond jamais et donnerait le même
    // résultat sans que l'intention soit lisible.
    const parUtilisateur = (code as any).usage_max_par_utilisateur ?? 1;
    if (utilisateurId && parUtilisateur > 0) {
      const n = await compter('code_id = $1 AND utilisateur_id = $2', [code.id, utilisateurId]);
      if (n >= parUtilisateur) return 'DEJA_UTILISE';
    }

    return null;
  }
}
