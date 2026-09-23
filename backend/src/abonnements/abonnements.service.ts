import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ActiverAbonnementDto } from './dto/activer-abonnement.dto';
import { FilterAbonnementDto } from './dto/filter-abonnement.dto';
import { ProlongerAbonnementDto } from './dto/prolonger-abonnement.dto';
import { SouscrireDto } from './dto/souscrire.dto';
import { AbonnementEvenement, TypeEvenementAbonnement } from './entities/abonnement-evenement.entity';
import { Abonnement, StatutAbonnement } from './entities/abonnement.entity';
import { EntitlementService } from './entitlement.service';
import { ModuleRef } from '@nestjs/core';
import { CodeValidationService } from '../codes/code-validation.service';
import { ParrainageService } from './parrainage.service';
import { PlansService } from './plans.service';

@Injectable()
export class AbonnementsService {
  private readonly logger = new Logger(AbonnementsService.name);

  constructor(
    @InjectRepository(Abonnement) private readonly abonnements: Repository<Abonnement>,
    @InjectRepository(AbonnementEvenement) private readonly evenementsRepository: Repository<AbonnementEvenement>,
    private readonly plansService: PlansService,
    private readonly entitlement: EntitlementService,
    private readonly parrainage: ParrainageService,
    private readonly dataSource: DataSource,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Résolution tardive : CodesModule importe AbonnementsModule pour PlansService,
   * l'inverse ne peut donc pas être une arête du graphe de modules.
   */
  private get codes(): CodeValidationService {
    return this.moduleRef.get(CodeValidationService, { strict: false });
  }

  /**
   * Ouvre un abonnement EN_ATTENTE. Il ne devient ACTIF qu'au paiement (#248)
   * ou par activation manuelle d'un admin.
   */
  async souscrire(pays: string, utilisateurId: number, dto: SouscrireDto): Promise<Abonnement> {
    const plan = await this.plansService.findByUuid(dto.plan_uuid);
    if (!plan.est_actif) {
      throw new ConflictException("Ce plan n'est pas disponible");
    }

    if (await this.entitlement.hasActiveSubscription(utilisateurId)) {
      throw new ConflictException('Vous avez déjà un abonnement actif');
    }

    const codeSaisi = dto.code ?? dto.code_parrainage;
    const resultat = codeSaisi
      ? await this.codes.valider(codeSaisi, utilisateurId, { planId: plan.id, prix: plan.prix, pays })
      : null;
    const codeValide = resultat?.valide ? resultat : null;

    if (codeSaisi && !codeValide) {
      throw new BadRequestException({
        code: 'CODE_PROMO_INVALIDE',
        motif: resultat?.motif ?? 'INTROUVABLE',
        message: "Le code saisi n'est pas valide pour cet abonnement",
      });
    }

    const effets = codeValide?.effets ?? {};
    const remise = effets.remise?.montant_remise ?? 0;
    const offert = !!effets.abonnement_offert;
    const gratuit = offert || remise >= Number(plan.prix);
    const parrainId = offert ? null : effets.commission_pour ?? null;

    // Une souscription en attente est réutilisée plutôt que dupliquée : sans
    // cela, chaque passage sur l'écran de paiement laisserait une ligne morte.
    const enAttente = await this.abonnements.findOne({
      where: { utilisateur_id: utilisateurId, statut: StatutAbonnement.EN_ATTENTE },
      order: { date_creation: 'DESC' },
    });
    if (enAttente) {
      enAttente.plan_id = plan.id;
      enAttente.devise = plan.devise;
      // Un code saisi au second passage doit être pris en compte : on libère la
      // souscription en attente pour repartir d'une résolution propre.
      const rafraichi = await this.dataSource.transaction(async (manager) => {
        await this.codes.libererPourAbonnement(enAttente.id, manager);

        let codeRetenu = codeValide?.code ?? null;
        if (codeRetenu) {
          const verrou = await this.codes.verrouillerEtValider(manager, codeRetenu.id, utilisateurId);
          if (!verrou.ok) {
            throw new ConflictException({
              code: 'CODE_PROMO_INDISPONIBLE',
              motif: verrou.motif,
              message: "Ce code n'est plus disponible. Vérifiez le total avant de réessayer.",
            });
          }
        }

        const retenu = !!codeRetenu;
        const offertRetenu = retenu && gratuit;
        const debut = offertRetenu ? new Date() : null;
        const duree = effets.abonnement_offert?.duree_jours ?? plan.duree_jours;
        const fin = offertRetenu ? new Date(debut!.getTime() + duree * 24 * 60 * 60 * 1000) : null;

        enAttente.statut = offertRetenu ? StatutAbonnement.ACTIF : StatutAbonnement.EN_ATTENTE;
        enAttente.date_debut = debut;
        enAttente.date_fin = fin;
        enAttente.parrain_id = retenu ? parrainId : null;
        enAttente.code_id = codeRetenu?.id ?? null;
        enAttente.montant_remise = retenu ? remise : 0;
        enAttente.offert = offertRetenu;

        const sauvegarde = await manager.getRepository(Abonnement).save(enAttente);
        if (codeRetenu) {
          await this.codes.enregistrerUtilisation(manager, codeRetenu.id, utilisateurId, {
            abonnementId: sauvegarde.id,
            montantRemise: enAttente.montant_remise,
            pays,
            effets,
          });
        }
        return sauvegarde;
      });
      return this.findByUuid(rafraichi.uuid);
    }

    // Le bénéficiaire est figé maintenant, pas au paiement : entre les deux, le
    // code pourrait être désactivé ou changer de propriétaire. Un abonnement
    // offert n'encaisse rien, donc ne verse aucune commission.

    const abonnement = await this.dataSource.transaction(async (manager) => {
      // L'ORDRE COMPTE. Le verrou sur le code se prend AVANT d'insérer
      // l'abonnement : l'insertion prend un FOR KEY SHARE sur la ligne de
      // `codes` via la clé étrangère, et l'élever ensuite en FOR UPDATE
      // provoque un interblocage dès deux acheteurs simultanés — observé sur le
      // devstack avec 10 requêtes parallèles.
      let codeRetenu = codeValide?.code ?? null;
      if (codeRetenu) {
        const verrou = await this.codes.verrouillerEtValider(manager, codeRetenu.id, utilisateurId);
        if (!verrou.ok) {
          throw new ConflictException({
            code: 'CODE_PROMO_INDISPONIBLE',
            motif: verrou.motif,
            message: "Ce code n'est plus disponible. Vérifiez le total avant de réessayer.",
          });
        }
      }
      const retenu = !!codeRetenu;
      const remiseRetenue = retenu ? remise : 0;
      const offertRetenu = retenu && gratuit;

      // Un abonnement offert est ACTIF d'emblée : il n'y a rien à encaisser, et
      // le laisser EN_ATTENTE obligerait un admin à confirmer un paiement qui
      // n'aura jamais lieu.
      const debut = offertRetenu ? new Date() : null;
      const duree = effets.abonnement_offert?.duree_jours ?? plan.duree_jours;
      const fin = offertRetenu ? new Date(debut!.getTime() + duree * 24 * 60 * 60 * 1000) : null;

      const cree = await manager.getRepository(Abonnement).save(
        manager.getRepository(Abonnement).create({
          pays,
          utilisateur_id: utilisateurId,
          plan_id: plan.id,
          statut: offertRetenu ? StatutAbonnement.ACTIF : StatutAbonnement.EN_ATTENTE,
          date_debut: debut,
          date_fin: fin,
          montant_paye: 0,
          montant_remise: remiseRetenue,
          offert: offertRetenu,
          devise: plan.devise,
          parrain_id: retenu ? parrainId : null,
          code_id: codeRetenu?.id ?? null,
        }),
      );

      if (codeRetenu) {
        await this.codes.enregistrerUtilisation(manager, codeRetenu.id, utilisateurId, {
          abonnementId: cree.id,
          montantRemise: remiseRetenue,
          pays,
          effets,
        });
      }
      return cree;
    });

    await this.journaliser(abonnement.id, TypeEvenementAbonnement.CREE, {
      planCode: plan.code,
      prix: plan.prix,
      parrainId: abonnement.parrain_id,
      code: abonnement.code_id ? codeValide?.code?.code : null,
      montantRemise: abonnement.montant_remise,
      offert: abonnement.offert,
    });

    if (abonnement.offert) {
      await this.journaliser(abonnement.id, TypeEvenementAbonnement.ACTIVE, {
        offert: true,
        code: codeValide?.code?.code,
        date_fin: abonnement.date_fin,
      });
    }

    this.logger.log(`Abonnement ${abonnement.uuid} créé (EN_ATTENTE) pour utilisateur ${utilisateurId}`);
    return this.findByUuid(abonnement.uuid);
  }

  /**
   * Active un abonnement payé.
   *
   * L'unicité de l'abonnement ACTIF est portée par un index partiel : deux
   * activations concurrentes lèvent une violation d'unicité plutôt que d'ouvrir
   * deux abonnements. On la traduit en 409 explicite.
   */
  async activer(uuid: string, dto: ActiverAbonnementDto, adminId?: number): Promise<Abonnement> {
    const abonnement = await this.findByUuid(uuid);

    if (abonnement.statut === StatutAbonnement.ACTIF) {
      throw new ConflictException('Cet abonnement est déjà actif');
    }
    if ([StatutAbonnement.ANNULE, StatutAbonnement.REMBOURSE].includes(abonnement.statut)) {
      throw new ConflictException(`Un abonnement ${abonnement.statut} ne peut pas être activé`);
    }

    const debut = new Date();
    const fin = new Date(debut.getTime() + abonnement.plan.duree_jours * 24 * 60 * 60 * 1000);

    abonnement.statut = StatutAbonnement.ACTIF;
    abonnement.date_debut = debut;
    abonnement.date_fin = fin;
    abonnement.montant_paye = dto.montant_paye;
    abonnement.metadata = {
      ...(abonnement.metadata ?? {}),
      activation_manuelle: true,
      reference_paiement: dto.reference_paiement ?? null,
      commentaire: dto.commentaire ?? null,
      active_par: adminId ?? null,
    };

    let sauvegarde: Abonnement;
    try {
      sauvegarde = await this.abonnements.save(abonnement);
    } catch (err) {
      if (String(err?.code) === '23505') {
        throw new ConflictException('Cet utilisateur a déjà un abonnement actif');
      }
      throw err;
    }

    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.PAYE, {
      montant: dto.montant_paye,
      reference: dto.reference_paiement ?? null,
      manuel: true,
    });
    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.ACTIVE, {
      date_debut: debut,
      date_fin: fin,
    });

    this.logger.log(`Abonnement ${uuid} activé jusqu'au ${fin.toISOString()} (activation manuelle)`);

    // Best-effort et HORS de ce qui précède : un échec de commission ne doit pas
    // annuler un abonnement déjà payé. Les abonnements restés à
    // `commission_versee = false` sont rattrapables depuis le back-office.
    const commission = await this.parrainage.verserCommission(await this.findByUuid(uuid));
    if (commission.verse) {
      await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.COMMISSION_VERSEE, {
        parrainId: sauvegarde.parrain_id,
        montantAbonnement: dto.montant_paye,
      });
    }

    return this.findByUuid(uuid);
  }


  /**
   * Rend son statut à un abonnement annulé, sans toucher à ses dates.
   *
   * `activer()` refuse explicitement un abonnement ANNULE, et à raison : on ne
   * réactive pas par inadvertance. Mais une annulation par erreur — ou un
   * remboursement revenu — laissait alors l'administration sans recours, sinon
   * créer une nouvelle souscription à 0 F qui perd le lien avec le paiement
   * encaissé.
   *
   * Les dates d'ORIGINE sont conservées : l'abonné ne gagne pas une période
   * pleine parce qu'on a corrigé une erreur, et il ne perd pas non plus les
   * jours écoulés. Un abonnement dont la date de fin est déjà passée est donc
   * remis en EXPIRE, pas en ACTIF — le réactiver le rendrait actif tout en
   * étant échu, ce que `check()` traiterait comme expiré de toute façon.
   */
  async reactiver(uuid: string, motif?: string, adminId?: number): Promise<Abonnement> {
    const abonnement = await this.findByUuid(uuid);

    if (abonnement.statut === StatutAbonnement.ACTIF) {
      throw new ConflictException('Cet abonnement est déjà actif');
    }
    if (abonnement.statut !== StatutAbonnement.ANNULE) {
      throw new ConflictException(
        `Seul un abonnement annulé peut être réactivé (celui-ci est ${abonnement.statut}).`,
      );
    }
    if (!abonnement.date_debut || !abonnement.date_fin) {
      throw new ConflictException(
        "Cet abonnement n'a jamais été activé : il n'a pas de période à restaurer. Activez-le plutôt.",
      );
    }

    const echu = abonnement.date_fin.getTime() <= Date.now();
    abonnement.statut = echu ? StatutAbonnement.EXPIRE : StatutAbonnement.ACTIF;
    abonnement.metadata = {
      ...(abonnement.metadata ?? {}),
      reactivation_manuelle: true,
      reactive_par: adminId ?? null,
      reactive_le: new Date().toISOString(),
      motif_reactivation: motif ?? null,
    };

    let sauvegarde: Abonnement;
    try {
      sauvegarde = await this.abonnements.save(abonnement);
    } catch (err) {
      // L'index unique n'autorise qu'un actif par compte : si la personne s'est
      // réabonnée entre-temps, on ne peut pas en rendre un second.
      if (String(err?.code) === '23505') {
        throw new ConflictException(
          "Cet utilisateur a déjà un abonnement actif. Annulez-le avant de réactiver celui-ci.",
        );
      }
      throw err;
    }

    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.ACTIVE, {
      reactivation: true,
      motif: motif ?? null,
      date_debut: sauvegarde.date_debut,
      date_fin: sauvegarde.date_fin,
      par: adminId ?? null,
    });

    this.logger.log(
      `Abonnement ${uuid} réactivé (${sauvegarde.statut}) par l'administrateur ${adminId ?? '?'}` +
        (motif ? ` — ${motif}` : ''),
    );
    return this.findByUuid(sauvegarde.uuid);
  }

  async activerApresPaiement(
    uuid: string,
    params: { montant: number; reference: string; paiementId: number; prestataire: string },
  ): Promise<Abonnement> {
    const abonnement = await this.findByUuid(uuid);

    if (abonnement.statut === StatutAbonnement.ACTIF) {
      return abonnement;
    }
    if ([StatutAbonnement.ANNULE, StatutAbonnement.REMBOURSE].includes(abonnement.statut)) {
      throw new ConflictException(`Un abonnement ${abonnement.statut} ne peut pas être activé`);
    }

    const debut = new Date();
    const fin = new Date(debut.getTime() + abonnement.plan.duree_jours * 24 * 60 * 60 * 1000);

    abonnement.statut = StatutAbonnement.ACTIF;
    abonnement.date_debut = debut;
    abonnement.date_fin = fin;
    abonnement.montant_paye = params.montant;
    abonnement.paiement_id = params.paiementId;
    abonnement.metadata = {
      ...(abonnement.metadata ?? {}),
      reference_paiement: params.reference,
      prestataire_paiement: params.prestataire,
    };

    let sauvegarde: Abonnement;
    try {
      sauvegarde = await this.abonnements.save(abonnement);
    } catch (err) {
      if (String(err?.code) === '23505') {
        throw new ConflictException('Cet utilisateur a déjà un abonnement actif');
      }
      throw err;
    }

    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.PAYE, {
      montant: params.montant,
      reference: params.reference,
      prestataire: params.prestataire,
    });
    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.ACTIVE, {
      date_debut: debut,
      date_fin: fin,
    });

    const commission = await this.parrainage.verserCommission(await this.findByUuid(uuid));
    if (commission.verse) {
      await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.COMMISSION_VERSEE, {
        parrainId: sauvegarde.parrain_id,
        montantAbonnement: params.montant,
      });
    }

    return this.findByUuid(uuid);
  }

  /**
   * Rattrape une commission non versée.
   *
   * Utile quand le wallet du parrain était bloqué au moment de l'activation, ou
   * quand la commission a été activée après coup.
   */
  async rattraperCommission(uuid: string) {
    const abonnement = await this.findByUuid(uuid);
    if (abonnement.statut !== StatutAbonnement.ACTIF) {
      throw new BadRequestException('Seul un abonnement actif ouvre droit à une commission');
    }
    const resultat = await this.parrainage.verserCommission(abonnement);
    if (resultat.verse) {
      await this.journaliser(abonnement.id, TypeEvenementAbonnement.COMMISSION_VERSEE, {
        parrainId: abonnement.parrain_id,
        rattrapage: true,
      });
    }
    return resultat;
  }

  /** Abonnements payés dont la commission n'est pas passée. */
  async commissionsEnAttente(pays: string) {
    return this.abonnements.find({
      where: { pays, statut: StatutAbonnement.ACTIF, commission_versee: false },
      order: { date_creation: 'DESC' },
      take: 100,
    }).then((lignes) => lignes.filter((a) => a.parrain_id !== null));
  }

  async annuler(uuid: string, motif?: string): Promise<Abonnement> {
    const abonnement = await this.findByUuid(uuid);
    if ([StatutAbonnement.ANNULE, StatutAbonnement.REMBOURSE].includes(abonnement.statut)) {
      throw new ConflictException(`Cet abonnement est déjà ${abonnement.statut}`);
    }
    abonnement.statut = StatutAbonnement.ANNULE;
    const sauvegarde = await this.abonnements.save(abonnement);
    // Rendre la place : sans cela, les codes d'une campagne limitée partiraient
    // en paniers abandonnés.
    await this.codes.libererPourAbonnement(sauvegarde.id);
    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.ANNULE, { motif: motif ?? null });
    return this.findByUuid(uuid);
  }

  async prolonger(uuid: string, dto: ProlongerAbonnementDto): Promise<Abonnement> {
    const abonnement = await this.findByUuid(uuid);
    if (abonnement.statut !== StatutAbonnement.ACTIF) {
      throw new BadRequestException('Seul un abonnement actif peut être prolongé');
    }
    const base = abonnement.date_fin > new Date() ? abonnement.date_fin : new Date();
    abonnement.date_fin = new Date(base.getTime() + dto.jours * 24 * 60 * 60 * 1000);
    const sauvegarde = await this.abonnements.save(abonnement);
    await this.journaliser(sauvegarde.id, TypeEvenementAbonnement.PROLONGE, {
      jours: dto.jours,
      motif: dto.motif ?? null,
      nouvelle_date_fin: abonnement.date_fin,
    });
    return this.findByUuid(uuid);
  }

  /** Abonnement courant de l'utilisateur, actif de préférence, sinon en attente. */
  async monAbonnement(utilisateurId: number): Promise<Abonnement | null> {
    const actif = await this.entitlement.abonnementActif(utilisateurId);
    if (actif) return actif;
    return this.abonnements.findOne({
      where: { utilisateur_id: utilisateurId, statut: StatutAbonnement.EN_ATTENTE },
      order: { date_creation: 'DESC' },
    });
  }

  async mesAbonnements(utilisateurId: number, pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;
    const [data, total] = await this.abonnements.findAndCount({
      where: { utilisateur_id: utilisateurId },
      order: { date_creation: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findAll(pays: string, filtre: FilterAbonnementDto) {
    const page = filtre.page ?? 1;
    const limit = filtre.limit ?? 10;

    const qb = this.abonnements
      .createQueryBuilder('abonnement')
      .leftJoinAndSelect('abonnement.plan', 'plan')
      .leftJoin('abonnement.utilisateur', 'utilisateur')
      .addSelect(['utilisateur.id', 'utilisateur.uuid', 'utilisateur.nom', 'utilisateur.prenom', 'utilisateur.email'])
      .where('abonnement.pays = :pays', { pays });

    if (filtre.statut) qb.andWhere('abonnement.statut = :statut', { statut: filtre.statut });
    if (filtre.plan_code) qb.andWhere('plan.code = :code', { code: filtre.plan_code.toUpperCase() });
    if (filtre.search) {
      qb.andWhere(
        '(utilisateur.nom ILIKE :q OR utilisateur.prenom ILIKE :q OR utilisateur.email ILIKE :q)',
        { q: `%${filtre.search}%` },
      );
    }

    const [data, total] = await qb
      .orderBy('abonnement.date_creation', filtre.sort_order === 'ASC' ? 'ASC' : 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByUuid(uuid: string): Promise<Abonnement> {
    const abonnement = await this.abonnements.findOne({ where: { uuid } });
    if (!abonnement) throw new NotFoundException('Abonnement introuvable');
    return abonnement;
  }

  /** Journal d'un abonnement, du plus récent au plus ancien. */
  async historique(uuid: string): Promise<AbonnementEvenement[]> {
    const abonnement = await this.findByUuid(uuid);
    return this.evenementsRepository.find({
      where: { abonnement_id: abonnement.id },
      order: { date_creation: 'DESC' },
    });
  }

  /** Le journal ne doit jamais faire échouer l'opération qu'il décrit. */
  async journaliser(
    abonnementId: number,
    type: TypeEvenementAbonnement,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.evenementsRepository.save(
        this.evenementsRepository.create({ abonnement_id: abonnementId, type, payload: payload ?? null }),
      );
    } catch (err) {
      this.logger.warn(`Journalisation ${type} échouée pour l'abonnement ${abonnementId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Bascule les abonnements arrivés à échéance.
   *
   * L'EntitlementService ne dépend PAS de ce cron — il compare déjà `date_fin`
   * à l'instant présent. Le cron matérialise le statut pour le back-office et
   * les KPI, et déclenche la notification.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expirerAbonnements(): Promise<number> {
    const echus = await this.entitlement.abonnementsAExpirer();
    if (!echus.length) return 0;

    for (const abonnement of echus) {
      abonnement.statut = StatutAbonnement.EXPIRE;
      await this.abonnements.save(abonnement);
      await this.journaliser(abonnement.id, TypeEvenementAbonnement.EXPIRE, {
        date_fin: abonnement.date_fin,
      });
    }

    this.logger.log(`${echus.length} abonnement(s) passé(s) à EXPIRE`);
    return echus.length;
  }
}
