import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { RoleType, Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { Abonnement, StatutAbonnement } from './entities/abonnement.entity';
import { FeatureQuota } from './entities/quota-consommation.entity';
import { VerrouService } from './verrou.service';
import { QuotaService } from './quota.service';
import { ProfilCompletionService } from '../utilisateurs/profil-completion.service';

/** Droits que l'application sait arbitrer. #245, #247 et #249 en ajouteront. */
export enum Feature {
  CONCOURS_DOWNLOAD = 'CONCOURS_DOWNLOAD',
  EPREUVE_VIEW = 'EPREUVE_VIEW',
  EXAMEN_NAT_VIEW = 'EXAMEN_NAT_VIEW',
  KETSIA_AI = 'KETSIA_AI',
  AI_STATS = 'AI_STATS',
}

export type MotifDecision =
  | 'SUBSCRIBED'
  | 'ADMIN'
  | 'FREE_QUOTA'
  | 'QUOTA_EXCEEDED'
  | 'SUBSCRIPTION_REQUIRED'
  /** Profil sous le seuil de complétion exigé (#259). */
  | 'PROFIL_INCOMPLET';

export interface DecisionDroit {
  allowed: boolean;
  reason: MotifDecision;
  quota?: { used: number; limit: number };
  abonnement?: { planCode: string; dateFin: Date };
}

/**
 * Arbitre unique des droits liés à l'abonnement.
 *
 * Sans effet de bord et bon marché : une requête indexée sur
 * (utilisateur_id, statut, date_fin). Les appelants décident eux-mêmes de
 * consommer un quota — `check()` ne compte rien, il constate.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    @InjectRepository(Abonnement) private readonly abonnements: Repository<Abonnement>,
    @InjectRepository(Utilisateur) private readonly utilisateurs: Repository<Utilisateur>,
    private readonly config: ConfigService,
    private readonly quotas: QuotaService,
    private readonly profils: ProfilCompletionService,
    private readonly verrou: VerrouService,
  ) {}

  /**
   * Fonctionnalités soumises au seuil de complétion du profil (#259).
   *
   * `AI_STATS` en est absent : la fonctionnalité n'existe pas encore (#249).
   */
  private static readonly PROFIL_REQUIS: Feature[] = [
    Feature.CONCOURS_DOWNLOAD,
    Feature.EPREUVE_VIEW,
    Feature.EXAMEN_NAT_VIEW,
    Feature.KETSIA_AI,
  ];

  /**
   * Fonctionnalités adossées à un quota gratuit (#245). Les concours n'en ont
   * pas : ils sont payants d'emblée (#244).
   */
  private static readonly QUOTA_PAR_FEATURE: Partial<Record<Feature, FeatureQuota>> = {
    [Feature.EPREUVE_VIEW]: FeatureQuota.RESOURCE_VIEW,
    [Feature.EXAMEN_NAT_VIEW]: FeatureQuota.RESOURCE_VIEW,
    [Feature.KETSIA_AI]: FeatureQuota.KETSIA_AI,
  };

  /**
   * Interrupteur de mise en service. À `false` — le défaut — le guard laisse
   * passer et journalise ce qu'il aurait refusé : on mesure l'impact avant de
   * couper un accès qui existe aujourd'hui.
   *
   * Devenu une méthode plutôt qu'un accesseur : le verrou est réglable par
   * pays depuis le back-office, et servir la valeur du Bénin au Sénégal
   * reviendrait à ignorer le réglage. La lecture reste synchrone — voir
   * VerrouService, ce chemin est celui de chaque téléchargement.
   */
  verrouActif(pays = 'benin'): boolean {
    return this.verrou.estActif(pays);
  }

  /** Abonnement ACTIF dont la date de fin n'est pas passée. */
  async abonnementActif(utilisateurId: number): Promise<Abonnement | null> {
    if (!utilisateurId) return null;
    return this.abonnements.findOne({
      where: {
        utilisateur_id: utilisateurId,
        statut: StatutAbonnement.ACTIF,
        // Un ACTIF dont la date est dépassée est lu comme expiré ici ; c'est le
        // cron qui écrit le statut. Ne pas dépendre du cron pour refuser.
        date_fin: MoreThan(new Date()),
      },
    });
  }

  async hasActiveSubscription(utilisateurId: number): Promise<boolean> {
    return (await this.abonnementActif(utilisateurId)) !== null;
  }

  /**
   * Le rôle voyage déjà dans le JWT (`req.user.role`) : quand l'appelant le
   * fournit, on s'épargne un aller-retour SQL. Sur une base distante, cette
   * requête coûtait autant que la question qu'on cherche vraiment à poser.
   */
  async estAdmin(utilisateurId: number, role?: string): Promise<boolean> {
    if (role !== undefined) return role === RoleType.ADMIN;
    if (!utilisateurId) return false;
    const user = await this.utilisateurs.findOne({
      where: { id: utilisateurId },
      select: ['id', 'role'],
    });
    return user?.role === RoleType.ADMIN;
  }

  /**
   * Décision pour une feature. Les quotas gratuits (#245) se brancheront ici :
   * ce point d'entrée ne changera pas pour les appelants.
   */
  async check(utilisateurId: number, feature: Feature, role?: string, pays = 'benin'): Promise<DecisionDroit> {
    // Le back-office ne doit jamais être bloqué par un abonnement.
    if (await this.estAdmin(utilisateurId, role)) {
      return { allowed: true, reason: 'ADMIN' };
    }

    // Le profil se vérifie AVANT l'abonnement : un abonné au profil incomplet
    // est refusé, ce que demande #259 en rattachant la règle au même dispositif.
    if (EntitlementService.PROFIL_REQUIS.includes(feature)) {
      const profil = await this.profils.estConforme(utilisateurId, pays);
      if (!profil.conforme) {
        return {
          allowed: false,
          reason: 'PROFIL_INCOMPLET',
          quota: { used: profil.pourcentage, limit: profil.seuil },
        };
      }
    }

    const abonnement = await this.abonnementActif(utilisateurId);
    if (abonnement) {
      return {
        allowed: true,
        reason: 'SUBSCRIBED',
        abonnement: { planCode: abonnement.plan?.code, dateFin: abonnement.date_fin },
      };
    }

    // Sans abonnement, une fonctionnalité adossée à un quota reste accessible
    // tant que le quota gratuit n'est pas épuisé. `check()` CONSTATE seulement :
    // c'est l'appelant qui décide de consommer, au moment où il sert vraiment
    // la ressource.
    const featureQuota = EntitlementService.QUOTA_PAR_FEATURE[feature];
    if (featureQuota) {
      const reglage = await this.quotas.reglage(featureQuota, pays);
      if (!reglage.estActif) return { allowed: true, reason: 'FREE_QUOTA' };
      const used = await this.quotas.compter(utilisateurId, featureQuota, pays);
      return used < reglage.limite
        ? { allowed: true, reason: 'FREE_QUOTA', quota: { used, limit: reglage.limite } }
        : { allowed: false, reason: 'QUOTA_EXCEEDED', quota: { used, limit: reglage.limite } };
    }

    return { allowed: false, reason: 'SUBSCRIPTION_REQUIRED' };
  }

  /** Décision par feature, pour que le mobile grise son interface sans se prendre un 403. */
  /**
   * Décision par fonctionnalité, pour que le client grise son interface sans
   * se prendre un 403.
   *
   * Depuis #245 les décisions divergent (quota épuisé sur les ressources mais
   * pas sur Ketsia, par exemple), donc on ne peut plus en calculer une seule.
   * L'abonnement et le rôle sont en revanche résolus UNE fois et réutilisés :
   * cinq appels nus à `check()` referaient cinq fois la même requête.
   */
  async mesDroits(utilisateurId: number, role?: string, pays = 'benin'): Promise<Record<Feature, DecisionDroit>> {
    const features = Object.values(Feature);

    if (await this.estAdmin(utilisateurId, role)) {
      return features.reduce(
        (acc, f) => ({ ...acc, [f]: { allowed: true, reason: 'ADMIN' as const } }),
        {} as Record<Feature, DecisionDroit>,
      );
    }

    // Même ordre que dans `check()` : le profil prime sur l'abonnement.
    const profil = await this.profils.estConforme(utilisateurId, pays);
    if (!profil.conforme) {
      const refus: DecisionDroit = {
        allowed: false,
        reason: 'PROFIL_INCOMPLET',
        quota: { used: profil.pourcentage, limit: profil.seuil },
      };
      return features.reduce(
        (acc, f) => ({
          ...acc,
          [f]: EntitlementService.PROFIL_REQUIS.includes(f) ? { ...refus } : { allowed: false, reason: 'SUBSCRIPTION_REQUIRED' as const },
        }),
        {} as Record<Feature, DecisionDroit>,
      );
    }

    const abonnement = await this.abonnementActif(utilisateurId);
    if (abonnement) {
      const decision: DecisionDroit = {
        allowed: true,
        reason: 'SUBSCRIBED',
        abonnement: { planCode: abonnement.plan?.code, dateFin: abonnement.date_fin },
      };
      return features.reduce((acc, f) => ({ ...acc, [f]: { ...decision } }), {} as Record<Feature, DecisionDroit>);
    }

    const etat = await this.quotas.etatPourUtilisateur(utilisateurId, pays);
    return features.reduce((acc, f) => {
      const featureQuota = EntitlementService.QUOTA_PAR_FEATURE[f];
      if (!featureQuota) {
        return { ...acc, [f]: { allowed: false, reason: 'SUBSCRIPTION_REQUIRED' as const } };
      }
      const { used, limit, est_actif } = etat[featureQuota];
      // Quota désactivé : la fonctionnalité est libre. Annoncer un `quota`
      // ferait afficher au client un plafond qui ne s'applique pas — et
      // contredirait `check()`, qui n'en renvoie aucun dans ce cas.
      if (!est_actif) {
        return { ...acc, [f]: { allowed: true, reason: 'FREE_QUOTA' as const } };
      }
      return {
        ...acc,
        [f]: used < limit
          ? { allowed: true, reason: 'FREE_QUOTA' as const, quota: { used, limit } }
          : { allowed: false, reason: 'QUOTA_EXCEEDED' as const, quota: { used, limit } },
      };
    }, {} as Record<Feature, DecisionDroit>);
  }

  /** Abonnements ACTIF dont la date de fin est passée — matière du cron. */
  async abonnementsAExpirer(): Promise<Abonnement[]> {
    return this.abonnements.find({
      where: { statut: StatutAbonnement.ACTIF, date_fin: LessThan(new Date()) },
    });
  }
}
