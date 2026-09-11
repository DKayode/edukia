import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigurationAbonnement } from './entities/configuration-abonnement.entity';

/** Ce que le back-office affiche : la valeur, son origine, et qui l'a posée. */
export interface EtatVerrou {
  verrou_actif: boolean;
  /** `base` : une bascule explicite fait autorité. `environnement` : table vide. */
  origine: 'base' | 'environnement';
  valeur_environnement: boolean;
  date_modification: Date | null;
  modifie_par: number | null;
}

/**
 * Le verrou d'accès, réglable sans déploiement.
 *
 * Il vivait dans `ABONNEMENTS_VERROU_ACTIF` seul : l'éteindre demandait une PR
 * et un redéploiement, alors que c'est le seul interrupteur qui refuse
 * réellement un accès. Un interrupteur d'urgence qui exige un déploiement n'en
 * est pas un.
 *
 * La variable d'environnement reste la valeur par défaut — tant qu'aucune
 * bascule n'a eu lieu, rien ne change pour personne, y compris sur les
 * environnements qui n'ont pas la table.
 *
 * LA LECTURE RESTE SYNCHRONE, à dessein. `verrouActif` est consulté par le
 * guard à chaque téléchargement ; y mettre une requête SQL dégraderait un
 * chemin dont la latence est déjà surveillée. On sert donc une valeur en
 * mémoire, rafraîchie à l'écriture et, à défaut, au bout de `FRAICHEUR_MS`.
 */
@Injectable()
export class VerrouService implements OnModuleInit {
  private readonly logger = new Logger(VerrouService.name);

  /** Au-delà, la valeur est rafraîchie en tâche de fond, sans bloquer. */
  private static readonly FRAICHEUR_MS = 30_000;

  private readonly cache = new Map<string, boolean>();
  private readonly lu = new Map<string, number>();
  private enCours = new Set<string>();

  constructor(
    @InjectRepository(ConfigurationAbonnement)
    private readonly configurations: Repository<ConfigurationAbonnement>,
    private readonly config: ConfigService,
  ) {}

  /** Valeur de repli, celle du déploiement. */
  get valeurEnvironnement(): boolean {
    return String(this.config.get('ABONNEMENTS_VERROU_ACTIF') ?? 'false').toLowerCase() === 'true';
  }

  async onModuleInit(): Promise<void> {
    // Charger au démarrage évite que la toute première requête réponde sur la
    // valeur d'environnement alors qu'une bascule existe en base.
    await this.recharger('benin').catch((err) =>
      this.logger.warn(`Chargement initial du verrou impossible : ${err?.message ?? err}`),
    );
  }

  /**
   * Lecture synchrone. Si la valeur a dépassé sa fraîcheur, on déclenche un
   * rafraîchissement en tâche de fond et on rend la valeur courante : mieux
   * vaut une valeur d'il y a trente secondes qu'une requête sur le chemin d'un
   * téléchargement.
   */
  estActif(pays = 'benin'): boolean {
    const lu = this.lu.get(pays) ?? 0;
    if (Date.now() - lu > VerrouService.FRAICHEUR_MS && !this.enCours.has(pays)) {
      this.enCours.add(pays);
      void this.recharger(pays)
        .catch(() => undefined)
        .finally(() => this.enCours.delete(pays));
    }
    return this.cache.get(pays) ?? this.valeurEnvironnement;
  }

  async etat(pays = 'benin'): Promise<EtatVerrou> {
    const ligne = await this.configurations.findOne({ where: { pays } });
    return {
      verrou_actif: ligne ? ligne.verrou_actif : this.valeurEnvironnement,
      origine: ligne ? 'base' : 'environnement',
      valeur_environnement: this.valeurEnvironnement,
      date_modification: ligne?.date_modification ?? null,
      modifie_par: ligne?.modifie_par ?? null,
    };
  }

  async basculer(pays: string, actif: boolean, parUtilisateurId?: number): Promise<EtatVerrou> {
    const ligne = (await this.configurations.findOne({ where: { pays } }))
      ?? this.configurations.create({ pays });
    ligne.verrou_actif = actif;
    ligne.modifie_par = parUtilisateurId ?? null;
    await this.configurations.save(ligne);

    // Rafraîchissement immédiat : sans lui, la bascule mettrait jusqu'à trente
    // secondes à produire son effet, et l'administrateur croirait à une panne.
    this.cache.set(pays, actif);
    this.lu.set(pays, Date.now());

    this.logger.warn(
      `Verrou ${actif ? 'ACTIVÉ' : 'DÉSACTIVÉ'} pour ${pays} par l'utilisateur ${parUtilisateurId ?? '?'}`,
    );
    return this.etat(pays);
  }

  private async recharger(pays: string): Promise<void> {
    const ligne = await this.configurations.findOne({ where: { pays } });
    // Table vide : on retombe sur l'environnement, sans mémoriser de `false`
    // qui masquerait un `true` de déploiement.
    this.cache.set(pays, ligne ? ligne.verrou_actif : this.valeurEnvironnement);
    this.lu.set(pays, Date.now());
  }
}
