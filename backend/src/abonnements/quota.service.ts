import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigurationQuota, PeriodeReset } from './entities/configuration-quota.entity';
import {
  FeatureQuota,
  QuotaConsommation,
  TypeRessourceQuota,
} from './entities/quota-consommation.entity';

/** Valeurs de repli si le pays n'a pas encore de configuration en base. */
export const QUOTA_DEFAUT: Record<FeatureQuota, number> = {
  [FeatureQuota.RESOURCE_VIEW]: 5,
  [FeatureQuota.KETSIA_AI]: 1,
};

export interface ReglageQuota {
  limite: number;
  periodeReset: PeriodeReset;
  estActif: boolean;
}

export interface ResultatConsommation {
  allowed: boolean;
  used: number;
  limit: number;
  /** `false` quand la ressource était déjà consommée sur la période : rien n'a été décompté. */
  nouveau: boolean;
  periode: string;
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    @InjectRepository(QuotaConsommation)
    private readonly consommations: Repository<QuotaConsommation>,
    @InjectRepository(ConfigurationQuota)
    private readonly configurations: Repository<ConfigurationQuota>,
  ) {}

  /**
   * Étiquette de période d'une consommation.
   *
   * `YYYY-MM` en UTC pour un quota mensuel. Le fuseau compte : un utilisateur à
   * Cotonou (UTC+1) verrait sinon son quota basculer une heure trop tôt ou trop
   * tard selon le serveur. UTC est arbitraire mais constant, et l'écart d'une
   * heure sur une frontière mensuelle est sans conséquence pratique.
   */
  periodeCourante(reglage: ReglageQuota, maintenant = new Date()): string {
    if (reglage.periodeReset === PeriodeReset.AVIE) return 'AVIE';
    const mois = String(maintenant.getUTCMonth() + 1).padStart(2, '0');
    return `${maintenant.getUTCFullYear()}-${mois}`;
  }

  /** Réglage en vigueur, avec repli sur les valeurs par défaut. */
  async reglage(feature: FeatureQuota, pays = 'benin'): Promise<ReglageQuota> {
    const config = await this.configurations.findOne({ where: { pays, feature } });
    if (!config) {
      return { limite: QUOTA_DEFAUT[feature], periodeReset: PeriodeReset.MENSUEL, estActif: true };
    }
    return {
      limite: config.limite,
      periodeReset: config.periode_reset,
      estActif: config.est_actif,
    };
  }

  async reglages(pays = 'benin'): Promise<ConfigurationQuota[]> {
    return this.configurations.find({ where: { pays }, order: { feature: 'ASC' } });
  }

  async modifierReglage(
    uuid: string,
    champs: Partial<Pick<ConfigurationQuota, 'limite' | 'periode_reset' | 'est_actif'>>,
  ): Promise<ConfigurationQuota> {
    const config = await this.configurations.findOne({ where: { uuid } });
    if (!config) throw new NotFoundException('Configuration de quota introuvable');
    Object.assign(config, champs);
    const sauvegarde = await this.configurations.save(config);
    this.logger.log(
      `Quota ${sauvegarde.feature} (${sauvegarde.pays}) : limite=${sauvegarde.limite} ` +
        `reset=${sauvegarde.periode_reset} actif=${sauvegarde.est_actif}`,
    );
    return sauvegarde;
  }

  /** Ressources distinctes déjà consommées sur la période en cours. */
  async compter(utilisateurId: number, feature: FeatureQuota, pays = 'benin'): Promise<number> {
    if (!utilisateurId) return 0;
    const periode = this.periodeCourante(await this.reglage(feature, pays));
    return this.consommations.count({ where: { utilisateur_id: utilisateurId, feature, periode } });
  }

  /**
   * Consomme le quota pour une ressource donnée, sur la période en cours.
   *
   * L'unicité en base fait le travail : on tente l'insertion, et un conflit
   * signifie que la ressource était déjà consommée ce mois-ci — donc autorisée
   * sans rien décompter. Compter puis insérer laisserait deux requêtes
   * concurrentes franchir la dernière unité ; ici la base tranche.
   */
  async consommer(
    utilisateurId: number,
    feature: FeatureQuota,
    resourceType: TypeRessourceQuota,
    resourceId: number,
    pays = 'benin',
  ): Promise<ResultatConsommation> {
    const reglage = await this.reglage(feature, pays);
    const periode = this.periodeCourante(reglage);
    const limit = reglage.limite;

    // Quota désactivé : la fonctionnalité redevient gratuite sans limite.
    if (!reglage.estActif) {
      return { allowed: true, used: 0, limit, nouveau: false, periode };
    }

    const cle = {
      utilisateur_id: utilisateurId,
      feature,
      resource_type: resourceType,
      resource_id: resourceId,
      periode,
    };

    const transaction = this.consommations.manager?.transaction?.bind(this.consommations.manager);
    const executer = async (repo: Repository<QuotaConsommation>) => {
      await repo.query?.(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`quota:${pays}:${utilisateurId}:${feature}:${periode}`],
      );

      if (await repo.findOne({ where: cle })) {
        return {
          allowed: true,
          used: await this.compterPeriodeAvecRepo(repo, utilisateurId, feature, periode),
          limit,
          nouveau: false,
          periode,
        };
      }

      const used = await this.compterPeriodeAvecRepo(repo, utilisateurId, feature, periode);
      if (used >= limit) {
        return { allowed: false, used, limit, nouveau: false, periode };
      }

      try {
        await repo.insert({ ...cle, pays });
        return { allowed: true, used: used + 1, limit, nouveau: true, periode };
      } catch (err) {
        // 23505 : une requête concurrente a inséré la même ligne. La ressource est
        // consommée, et une seule fois — on autorise.
        if (String(err?.code) === '23505') {
          return {
            allowed: true,
            used: await this.compterPeriodeAvecRepo(repo, utilisateurId, feature, periode),
            limit,
            nouveau: false,
            periode,
          };
        }
        throw err;
      }
    };

    return transaction
      ? transaction((manager) => executer(manager.getRepository(QuotaConsommation)))
      : executer(this.consommations);
  }

  /**
   * Identifiants déjà consommés sur la période, pour le drapeau
   * `deja_consultee` des listes. Une requête par appel HTTP, jamais une par
   * ligne : sans lui, l'application ferait croire qu'ouvrir une ressource déjà
   * vue ce mois-ci coûte une nouvelle unité.
   */
  async ressourcesConsommees(
    utilisateurId: number,
    feature: FeatureQuota,
    resourceType: TypeRessourceQuota,
    pays = 'benin',
  ): Promise<Set<number>> {
    if (!utilisateurId) return new Set();
    const periode = this.periodeCourante(await this.reglage(feature, pays));
    const lignes = await this.consommations.find({
      where: { utilisateur_id: utilisateurId, feature, resource_type: resourceType, periode },
      select: ['resource_id'],
    });
    return new Set(lignes.map((l) => l.resource_id));
  }

  /** État des quotas d'un utilisateur, toutes features confondues. */
  async etatPourUtilisateur(utilisateurId: number, pays = 'benin') {
    const features = Object.values(FeatureQuota);
    const etats = await Promise.all(
      features.map(async (f) => {
        const reglage = await this.reglage(f, pays);
        const periode = this.periodeCourante(reglage);
        const used = utilisateurId
          ? await this.compterPeriode(utilisateurId, f, periode)
          : 0;
        return {
          used,
          limit: reglage.limite,
          est_actif: reglage.estActif,
          periode_reset: reglage.periodeReset,
          // Date de remise à zéro, pour que le client puisse l'annoncer.
          reinitialisation: reglage.periodeReset === PeriodeReset.MENSUEL
            ? this.debutPeriodeSuivante()
            : null,
        };
      }),
    );
    return features.reduce((acc, f, i) => ({ ...acc, [f]: etats[i] }), {} as Record<FeatureQuota, any>);
  }

  private async compterPeriode(utilisateurId: number, feature: FeatureQuota, periode: string) {
    return this.compterPeriodeAvecRepo(this.consommations, utilisateurId, feature, periode);
  }

  private async compterPeriodeAvecRepo(
    repo: Repository<QuotaConsommation>,
    utilisateurId: number,
    feature: FeatureQuota,
    periode: string,
  ) {
    return repo.count({ where: { utilisateur_id: utilisateurId, feature, periode } });
  }

  /** Premier jour du mois suivant, en UTC — cohérent avec `periodeCourante`. */
  private debutPeriodeSuivante(maintenant = new Date()): Date {
    return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1, 0, 0, 0));
  }
}
