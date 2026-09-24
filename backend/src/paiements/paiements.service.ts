import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, DataSource, Repository } from 'typeorm';
import { AbonnementsService } from '../abonnements/abonnements.service';
import { ParrainageService } from '../abonnements/parrainage.service';
import { TypeEvenementAbonnement } from '../abonnements/entities/abonnement-evenement.entity';
import { Abonnement, StatutAbonnement } from '../abonnements/entities/abonnement.entity';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { ConfigurationPaiement } from './entities/configuration-paiement.entity';
import { PaiementWebhook } from './entities/paiement-webhook.entity';
import { Paiement } from './entities/paiement.entity';
import { FilterPaiementsDto } from './dto/filter-paiements.dto';
import { InitierPaiementDto } from './dto/initier-paiement.dto';
import { PaiementCredentialsService } from './paiement-credentials.service';
import { PaiementProviderRegistry } from './providers/paiement-provider.registry';
import { MethodePaiement, ModePaiement, PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';
import { PlanAbonnement } from '../abonnements/entities/plan-abonnement.entity';
import { CommandesCodesService } from '../codes/commandes-codes.service';
import { StatutCommande } from '../codes/entities/commande-code.entity';

const STATUTS_FINAUX = new Set([
  StatutPaiement.REUSSI,
  StatutPaiement.ECHOUE,
  StatutPaiement.ANNULE,
  StatutPaiement.EXPIRE,
  StatutPaiement.REMBOURSE,
]);
const RANG_STATUT: Record<StatutPaiement, number> = {
  [StatutPaiement.INITIE]: 0,
  [StatutPaiement.EN_ATTENTE]: 1,
  [StatutPaiement.ECHOUE]: 2,
  [StatutPaiement.ANNULE]: 2,
  [StatutPaiement.EXPIRE]: 2,
  [StatutPaiement.REUSSI]: 3,
  [StatutPaiement.REMBOURSE]: 4,
};
const PRESTATAIRES_PUBLICS: Partial<Record<PrestatairePaiement, string>> = {
  [PrestatairePaiement.KKIAPAY]: 'KKiaPay',
  [PrestatairePaiement.FEDAPAY]: 'FedaPay',
  [PrestatairePaiement.STRIPE]: 'Stripe',
  [PrestatairePaiement.REVENUECAT]: 'RevenueCat',
};

@Injectable()
export class PaiementsService {
  private readonly logger = new Logger(PaiementsService.name);

  constructor(
    @InjectRepository(Paiement) private readonly paiements: Repository<Paiement>,
    @InjectRepository(PaiementWebhook) private readonly webhooks: Repository<PaiementWebhook>,
    @InjectRepository(ConfigurationPaiement) private readonly configurations: Repository<ConfigurationPaiement>,
    @InjectRepository(Abonnement) private readonly abonnements: Repository<Abonnement>,
    @InjectRepository(Utilisateur) private readonly utilisateurs: Repository<Utilisateur>,
    @InjectRepository(PlanAbonnement) private readonly plans: Repository<PlanAbonnement>,
    private readonly providers: PaiementProviderRegistry,
    private readonly abonnementsService: AbonnementsService,
    private readonly parrainageService: ParrainageService,
    private readonly credentials: PaiementCredentialsService,
    private readonly dataSource: DataSource,
    private readonly commandes: CommandesCodesService,
    private readonly config: ConfigService,
  ) {}

  async prestatairesDisponibles(pays: string) {
    const configurations = await this.configurations.find({
      where: { pays, est_actif: true },
      order: { prestataire: 'ASC', mode: 'ASC' },
    });
    const disponibles = configurations.length > 0
      ? configurations
      : this.configurationEnvParDefaut(pays).map((config) => this.configurations.create(config));

    return {
      pays,
      prestataires: disponibles.flatMap((configuration) => {
        const libelle = PRESTATAIRES_PUBLICS[configuration.prestataire];
        if (!libelle) return [];
        return [{
          pays: configuration.pays,
          prestataire: configuration.prestataire,
          libelle,
          mode: configuration.mode,
          devise: configuration.devise,
          montant_min: configuration.montant_min,
          montant_max: configuration.montant_max,
        }];
      }),
    };
  }

  async initier(pays: string, utilisateurId: number, dto: InitierPaiementDto) {
    // Un paiement vise soit un abonnement pour soi, soit une commande de codes
    // à distribuer. Exiger l'un des deux, et refuser les deux à la fois : sans
    // cette garde, un appel portant les deux paierait l'un et créditerait
    // l'autre.
    if (!dto.abonnement_uuid === !dto.commande_uuid) {
      throw new BadRequestException(
        'Indiquez soit `abonnement_uuid`, soit `commande_uuid` — un seul des deux.',
      );
    }
    if (dto.commande_uuid) {
      return this.initierCommande(pays, utilisateurId, dto);
    }

    const abonnement = await this.abonnements.findOne({ where: { uuid: dto.abonnement_uuid, utilisateur_id: utilisateurId, pays } });
    if (!abonnement) throw new NotFoundException('Abonnement introuvable');
    if (abonnement.statut !== StatutAbonnement.EN_ATTENTE) {
      throw new ConflictException("Seul un abonnement en attente peut être payé");
    }

    const config = await this.configurationActive(pays, dto.prestataire);
    const montant = Number(abonnement.plan.prix) - Number((abonnement as any).montant_remise ?? 0);
    if (montant <= 0) throw new ConflictException("Cet abonnement ne nécessite pas de paiement");
    this.verifierPlafonds(config, montant);

    const utilisateur = await this.utilisateurs.findOne({ where: { id: utilisateurId } });
    if (!utilisateur) throw new NotFoundException('Utilisateur introuvable');

    const provider = this.providers.get(config.prestataire);
    const reference = `EDK-${Date.now()}-${utilisateurId}-${abonnement.id}`;
    const expiration = new Date(Date.now() + 30 * 60 * 1000);
    const paiement = await this.paiements.save(this.paiements.create({
      pays,
      reference,
      utilisateur_id: utilisateurId,
      abonnement_id: abonnement.id,
      montant,
      devise: config.devise,
      prestataire: config.prestataire,
      mode: config.mode,
      methode: dto.methode ?? MethodePaiement.MOBILE_MONEY,
      statut: StatutPaiement.INITIE,
      date_expiration: expiration,
    }));

    const frontendBaseUrl = this.baseUrlPublique(process.env.FRONTEND_URL, 'https://educ-prime.com');
    const webhookBaseUrl = this.baseUrlPublique(
      process.env.PAIEMENT_WEBHOOK_BASE_URL ?? process.env.API_PUBLIC_URL,
      'https://api.educ-prime.com',
    );
    const retour = `${frontendBaseUrl}/abonnements?paiement=${paiement.uuid}`;
    const resultat = await provider.initier({
      reference,
      mode: config.mode,
      montant,
      devise: config.devise,
      client: {
        nom: [utilisateur.prenom, utilisateur.nom].filter(Boolean).join(' ') || utilisateur.email,
        email: utilisateur.email,
        telephone: dto.telephone ?? utilisateur.telephone,
      },
      urlRetour: retour,
      urlWebhook: `${webhookBaseUrl}/paiements/webhooks/${config.prestataire.toLowerCase()}`,
      metadata: { paiementUuid: paiement.uuid, abonnementUuid: abonnement.uuid },
      credentials: this.credentials.decrypt(config.credentials_chiffres),
    });

    paiement.statut = StatutPaiement.EN_ATTENTE;
    paiement.reference_prestataire = resultat.referencePrestataire ?? null;
    paiement.url_paiement = resultat.urlPaiement ?? null;
    paiement.token_client = resultat.tokenClient ?? null;
    paiement.payload_initiation = resultat.payload as any;
    const sauvegarde = await this.paiements.save(paiement);
    await this.abonnements.update(abonnement.id, { paiement_id: sauvegarde.id });
    return sauvegarde;
  }

  async findOne(pays: string, utilisateurId: number, uuid: string) {
    const paiement = await this.paiements.findOne({ where: { uuid, pays, utilisateur_id: utilisateurId } });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    return paiement;
  }

  async confirmerTransactionMobile(pays: string, utilisateurId: number, uuid: string, dto: { reference_prestataire: string }) {
    const paiement = await this.paiements.findOne({ where: { uuid, pays, utilisateur_id: utilisateurId } });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    if (STATUTS_FINAUX.has(paiement.statut)) return paiement;

    paiement.reference_prestataire = dto.reference_prestataire;
    await this.paiements.save(paiement);

    const config = await this.configurationPourPaiement(paiement);
    const provider = this.providers.get(paiement.prestataire);
    const statut = await provider.verifierStatut(
      dto.reference_prestataire,
      this.credentials.decrypt(config?.credentials_chiffres),
      paiement.mode,
    );
    await this.appliquerStatutVerifie(paiement, statut.statut, statut.montant, { mobile: true, reference_prestataire: dto.reference_prestataire });
    return this.findOne(pays, utilisateurId, uuid);
  }

  /**
   * Vérification à la demande, déclenchée par le mobile au retour du paiement.
   *
   * Le chemin nominal reste le webhook : c'est lui qui active en quelques
   * secondes, sans que personne n'ait à demander. Cette route couvre le cas
   * où il n'arrive pas — prestataire muet, endpoint mal déclaré, réseau
   * coupé — pour que l'utilisateur n'attende pas le prochain passage du cron.
   *
   * Contrairement à `confirmerTransactionMobile`, elle ne prend aucun corps :
   * la référence prestataire a été enregistrée à l'initiation. Le mobile n'a
   * donc rien à transporter, ce qui la rend appelable après un retour par
   * redirection, où l'application ne récupère parfois aucun identifiant.
   *
   * Idempotente : sur un paiement déjà dans un statut final, on renvoie
   * l'état sans rappeler le prestataire.
   */
  async verifierMaintenant(pays: string, utilisateurId: number, uuid: string) {
    const paiement = await this.paiements.findOne({ where: { uuid, pays, utilisateur_id: utilisateurId } });
    if (!paiement) throw new NotFoundException('Paiement introuvable');

    if (!STATUTS_FINAUX.has(paiement.statut)) {
      if (!paiement.reference_prestataire) {
        // Le paiement n'a jamais atteint le prestataire : il n'existe nulle
        // part ailleurs que chez nous, et aucune vérification n'est possible.
        // On le dit plutôt que de renvoyer un EN_ATTENTE qui laisse espérer.
        throw new ConflictException({
          code: 'PAIEMENT_NON_TRANSMIS',
          message: 'Ce paiement n’a jamais été transmis au prestataire. Relancez-en un nouveau.',
        });
      }

      const config = await this.configurationPourPaiement(paiement);
      const provider = this.providers.get(paiement.prestataire);
      try {
        const statut = await provider.verifierStatut(
          paiement.reference_prestataire,
          this.credentials.decrypt(config?.credentials_chiffres),
          paiement.mode,
        );
        await this.appliquerStatutVerifie(paiement, statut.statut, statut.montant, {
          verification_a_la_demande: true,
        });
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof ConflictException) throw err;
        // Le prestataire est injoignable ou répond de travers. Le cron
        // repassera : on ne transforme pas une panne distante en échec.
        this.logger.warn(`Vérification à la demande de ${uuid} échouée: ${err?.message ?? err}`);
        throw new ServiceUnavailableException({
          code: 'VERIFICATION_INDISPONIBLE',
          message: 'Le prestataire est momentanément injoignable. Réessayez dans un instant.',
        });
      }
    }

    return this.etatPaiement(pays, utilisateurId, uuid);
  }

  /**
   * Ce que le mobile a besoin de savoir en un seul appel : où en est le
   * paiement, et surtout ce qu'il a débloqué. Interroger l'abonnement
   * séparément ferait une seconde requête dont la réponse pourrait
   * précéder l'activation.
   */
  private async etatPaiement(pays: string, utilisateurId: number, uuid: string) {
    const paiement = await this.findOne(pays, utilisateurId, uuid);

    let abonnement: Record<string, unknown> | null = null;
    if (paiement.abonnement_id) {
      const trouve = await this.abonnements.findOne({ where: { id: paiement.abonnement_id } });
      if (trouve) {
        abonnement = {
          uuid: trouve.uuid,
          statut: trouve.statut,
          date_debut: trouve.date_debut,
          date_fin: trouve.date_fin,
        };
      }
    }

    let commande: Record<string, unknown> | null = null;
    if (paiement.commande_id) {
      const trouvee = await this.commandes.parId(paiement.commande_id, utilisateurId);
      if (trouvee) {
        commande = {
          uuid: trouvee.uuid,
          statut: trouvee.statut,
          quantite: trouvee.quantite,
        };
      }
    }

    return {
      paiement: {
        uuid: paiement.uuid,
        statut: paiement.statut,
        montant: paiement.montant,
        devise: paiement.devise,
        prestataire: paiement.prestataire,
        date_confirmation: paiement.date_confirmation,
      },
      abonnement,
      commande,
    };
  }

  async mesPaiements(pays: string, utilisateurId: number, pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;
    const [data, total] = await this.paiements.findAndCount({
      where: { pays, utilisateur_id: utilisateurId },
      order: { date_creation: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async adminList(pays: string, filtre: FilterPaiementsDto) {
    const page = filtre.page ?? 1;
    const limit = filtre.limit ?? 20;
    const qb = this.paiements.createQueryBuilder('p').where('p.pays = :pays', { pays });
    if (filtre.statut) qb.andWhere('p.statut = :statut', { statut: filtre.statut });
    if (filtre.prestataire) qb.andWhere('p.prestataire = :prestataire', { prestataire: filtre.prestataire });
    if (filtre.search) qb.andWhere('(p.reference ILIKE :q OR p.reference_prestataire ILIKE :q)', { q: `%${filtre.search}%` });
    const [data, total] = await qb.orderBy('p.date_creation', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async adminConfigurations(pays: string) {
    const configs = await this.configurations.find({ where: { pays }, order: { prestataire: 'ASC', mode: 'ASC' } });
    const visibles = configs.length > 0
      ? configs
      : this.configurationEnvParDefaut(pays).map((config) => this.configurations.create(config));
    return visibles.map((config) => this.configurationPublique(config));
  }

  async configurerPrestataire(
    pays: string,
    dto: {
      prestataire: PrestatairePaiement;
      mode?: ModePaiement;
      devise?: string;
      montant_min?: number | null;
      montant_max?: number | null;
      est_actif?: boolean;
      credentials?: Record<string, string>;
    },
  ) {
    const mode = dto.mode ?? ModePaiement.SANDBOX;
    const existante = await this.configurations.findOne({ where: { pays, prestataire: dto.prestataire, mode } });
    const config = existante ?? this.configurations.create({ pays, prestataire: dto.prestataire, mode });
    config.mode = dto.mode ?? config.mode ?? ModePaiement.SANDBOX;
    config.devise = dto.devise ?? config.devise ?? (dto.prestataire === PrestatairePaiement.STRIPE ? 'EUR' : 'XOF');
    config.montant_min = dto.montant_min !== undefined ? dto.montant_min : config.montant_min ?? null;
    config.montant_max = dto.montant_max !== undefined ? dto.montant_max : config.montant_max ?? null;
    config.est_actif = dto.est_actif ?? config.est_actif ?? false;

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      const existants = this.credentials.decrypt(config.credentials_chiffres);
      const fusion = { ...existants, ...dto.credentials };
      config.credentials_chiffres = this.credentials.encrypt(fusion);
      config.credentials_masquees = this.credentials.mask(fusion);
    }

    return this.dataSource.transaction(async (manager) => {
      // Si on active cette config, desactiver les autres modes du meme prestataire dans le meme pays
      // Cela permet d'avoir plusieurs prestataires actifs (KKIAPAY + FEDAPAY + STRIPE)
      // mais un seul mode (sandbox OU live) actif par prestataire
      if (config.est_actif) {
        await manager.getRepository(ConfigurationPaiement).update(
          { 
            pays: config.pays,
            prestataire: config.prestataire,
            est_actif: true
          },
          { est_actif: false }
        );
      }
      const sauvegarde = await manager.getRepository(ConfigurationPaiement).save(config);
      return this.configurationPublique(sauvegarde);
    });
  }

  async confirmerManuellement(pays: string, uuid: string, dto: { montant?: number; reference_prestataire?: string; commentaire?: string }) {
    const paiement = await this.paiementAdmin(pays, uuid);
    if (paiement.statut === StatutPaiement.REMBOURSE) throw new ConflictException('Un paiement remboursé ne peut pas être confirmé');
    if (paiement.statut === StatutPaiement.REUSSI) return paiement;
    const montant = dto.montant ?? paiement.montant;
    if (Number(montant) !== Number(paiement.montant)) {
      throw new BadRequestException('Le montant confirmé ne correspond pas au montant attendu');
    }
    paiement.statut = StatutPaiement.REUSSI;
    paiement.reference_prestataire = dto.reference_prestataire ?? paiement.reference_prestataire;
    paiement.date_confirmation = new Date();
    paiement.payload_confirmation = {
      manuel: true,
      commentaire: dto.commentaire ?? null,
      reference_prestataire: dto.reference_prestataire ?? null,
    };
    await this.paiements.save(paiement);
    await this.activerAbonnementPaye(paiement);
    return this.paiementAdmin(pays, uuid);
  }

  async resynchroniser(pays: string, uuid: string) {
    const paiement = await this.paiementAdmin(pays, uuid);
    if (!paiement.reference_prestataire) throw new BadRequestException('Aucune référence prestataire à resynchroniser');
    if (paiement.statut === StatutPaiement.REMBOURSE) return paiement;
    const config = await this.configurationPourPaiement(paiement);
    const provider = this.providers.get(paiement.prestataire);
    const statut = await provider.verifierStatut(paiement.reference_prestataire, this.credentials.decrypt(config?.credentials_chiffres), paiement.mode);
    await this.appliquerStatutVerifie(paiement, statut.statut, statut.montant, { resynchronisation: true });
    return this.paiementAdmin(pays, uuid);
  }

  async rembourser(pays: string, uuid: string, dto: { motif?: string }) {
    const paiement = await this.paiementAdmin(pays, uuid);
    const dejaRembourse = paiement.statut === StatutPaiement.REMBOURSE;
    if (paiement.statut !== StatutPaiement.REUSSI && !dejaRembourse) {
      throw new ConflictException('Seul un paiement réussi peut être marqué remboursé');
    }

    const remboursementExistant = (paiement.payload_confirmation as any)?.remboursement ?? {};
    if (!dejaRembourse) {
      paiement.statut = StatutPaiement.REMBOURSE;
      paiement.payload_confirmation = {
        ...(paiement.payload_confirmation ?? {}),
        remboursement: {
          motif: dto.motif ?? null,
          date: new Date().toISOString(),
        },
      };
      await this.paiements.save(paiement);
    }

    let repriseCommission: Awaited<ReturnType<ParrainageService['reprendreCommission']>> | null = null;
    if (paiement.abonnement_id) {
      const abonnement = await this.abonnements.findOne({ where: { id: paiement.abonnement_id } });
      if (abonnement) {
        const vientDEtreRembourse = abonnement.statut === StatutAbonnement.ACTIF;
        if (vientDEtreRembourse) {
          abonnement.statut = StatutAbonnement.REMBOURSE;
          await this.abonnements.save(abonnement);
        }

        repriseCommission = await this.parrainageService.reprendreCommission(abonnement);
        if (vientDEtreRembourse) {
          await this.abonnementsService.journaliser(abonnement.id, TypeEvenementAbonnement.REMBOURSE, {
            paiement: paiement.reference,
            motif: dto.motif ?? null,
            repriseCommission,
          });
        }
      }
    }

    paiement.payload_confirmation = {
      ...(paiement.payload_confirmation ?? {}),
      remboursement: {
        ...remboursementExistant,
        ...((paiement.payload_confirmation as any)?.remboursement ?? {}),
        reprise_commission: repriseCommission,
      },
    };
    await this.paiements.save(paiement);
    return this.paiementAdmin(pays, uuid);
  }

  async recevoirWebhook(prestataire: PrestatairePaiement, rawBody: Buffer, headers: Record<string, any>, payload: unknown) {
    const provider = this.providers.get(prestataire);
    const configs = await this.configurations.find({ where: { prestataire, est_actif: true } });
    const signatureValide = configs.length > 0
      ? configs.some((config) => provider.verifierSignature(rawBody, headers, this.credentials.decrypt(config.credentials_chiffres)))
      : provider.verifierSignature(rawBody, headers);
    let evenementId = `${prestataire}-${Date.now()}`;
    try {
      evenementId = provider.parserWebhook(payload).evenementId;
    } catch {}

    let webhook: PaiementWebhook;
    try {
      webhook = await this.webhooks.save(this.webhooks.create({
        prestataire,
        evenement_id: evenementId,
        signature_valide: signatureValide,
        payload: payload as any,
      }));
    } catch (err) {
      if (String(err?.code) === '23505') return { received: true, duplicate: true };
      throw err;
    }

    if (!signatureValide) {
      await this.webhooks.update(webhook.id, { erreur_traitement: 'SIGNATURE_INVALIDE' });
      throw new UnauthorizedException('Signature webhook invalide');
    }

    try {
      await this.traiterWebhook(webhook.id, prestataire, payload);
      return { received: true };
    } catch (err) {
      await this.webhooks.update(webhook.id, { erreur_traitement: err?.message ?? String(err) });
      throw err;
    }
  }

  async traiterWebhook(webhookId: number, prestataire: PrestatairePaiement, payload: unknown) {
    const provider = this.providers.get(prestataire);
    const evt = provider.parserWebhook(payload);

    // Cycle de vie RevenueCat : résiliation et expiration ne sont pas des
    // paiements. Une résiliation coupe le renouvellement sans révoquer l'accès
    // (Apple/Google le laissent courir jusqu'à l'échéance) ; une expiration
    // coupe l'accès. Ces cas agissent sur l'abonnement, pas sur un paiement, et
    // ne doivent donc pas emprunter le chemin d'activation.
    if (prestataire === PrestatairePaiement.REVENUECAT) {
      const traite = await this.traiterCycleVieRevenueCat(payload);
      if (traite) {
        await this.webhooks.update(webhookId, { traite: true });
        return;
      }
    }

    let paiement = evt.referencePrestataire
      ? await this.paiements.findOne({ where: { prestataire, reference_prestataire: evt.referencePrestataire } })
        ?? (evt.reference ? await this.paiements.findOne({ where: { prestataire, reference: evt.reference } }) : null)
      : await this.paiements.findOne({ where: { prestataire, reference: evt.reference } });
    // Un achat in-app n'a PAS été initié chez nous : l'utilisateur paie
    // directement Apple ou Google, et RevenueCat nous prévient après coup. Il
    // n'existe donc aucun paiement à retrouver — il faut le créer ici, sinon la
    // notification est jetée et l'abonnement reste en attente alors que le
    // store, lui, considère la personne comme abonnée.
    if (!paiement && prestataire === PrestatairePaiement.REVENUECAT) {
      paiement = await this.creerPaiementAchatInApp(evt, payload);
    }

    if (!paiement) {
      this.logger.warn(`Webhook ${prestataire} ignoré : aucun paiement trouvé (ref=${evt.reference}, refPrestataire=${evt.referencePrestataire})`);
      await this.webhooks.update(webhookId, { traite: true, erreur_traitement: 'PAIEMENT_INTROUVABLE_IGNORE' });
      return;
    }
    if (STATUTS_FINAUX.has(paiement.statut)) return;

    // En mode widget KKiaPay, reference_prestataire est null a l'initiation.
    // Le webhook apporte la reference : on la persiste ici.
    if (!paiement.reference_prestataire && evt.referencePrestataire) {
      paiement.reference_prestataire = evt.referencePrestataire;
      await this.paiements.save(paiement);
    }

    const config = await this.configurationPourPaiement(paiement);
    const refVerif = paiement.reference_prestataire ?? evt.referencePrestataire;
    const statutVerifie = refVerif && prestataire !== PrestatairePaiement.REVENUECAT
      ? await provider.verifierStatut(refVerif, this.credentials.decrypt(config?.credentials_chiffres), paiement.mode)
      : { statut: evt.statut, montant: evt.montant, devise: evt.devise };
    paiement.methode = evt.methode ?? paiement.methode;
    await this.appliquerStatutVerifie(paiement, statutVerifie.statut, statutVerifie.montant, payload as any);

    await this.webhooks.update(webhookId, { traite: true });
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcilierPaiements(): Promise<number> {
    const paiements = await this.paiements.find({
      where: { statut: StatutPaiement.EN_ATTENTE },
      order: { date_creation: 'ASC' },
      take: 100,
    });
    let traites = 0;
    for (const paiement of paiements) {
      try {
        if (paiement.date_expiration && paiement.date_expiration < new Date()) {
          paiement.statut = StatutPaiement.EXPIRE;
          await this.paiements.save(paiement);
          traites++;
          continue;
        }
        if (!paiement.reference_prestataire) continue;
        const config = await this.configurationPourPaiement(paiement);
        const provider = this.providers.get(paiement.prestataire);
        const statut = await provider.verifierStatut(paiement.reference_prestataire, this.credentials.decrypt(config?.credentials_chiffres), paiement.mode);
        if (statut.statut !== StatutPaiement.EN_ATTENTE) {
          await this.appliquerStatutVerifie(paiement, statut.statut, statut.montant, { reconciliation: true });
          traites++;
        }
      } catch (err) {
        this.logger.warn(`Réconciliation du paiement ${paiement.uuid} échouée: ${err?.message ?? err}`);
      }
    }
    return traites;
  }

  private async configurationActive(pays: string, prestataire?: PrestatairePaiement): Promise<ConfigurationPaiement> {
    const where = prestataire ? { pays, prestataire, est_actif: true } : { pays, est_actif: true };
    const config = await this.configurations.findOne({ where });
    if (config) return config;

    const envConfig = this.configurationEnvParDefaut(pays, prestataire)[0];
    if (envConfig) return this.configurations.create(envConfig);

    throw new ServiceUnavailableException({
      code: 'PAIEMENT_INDISPONIBLE',
      message: 'Le paiement en ligne est temporairement indisponible',
    });
  }

  private verifierPlafonds(config: ConfigurationPaiement, montant: number) {
    if (config.montant_min != null && montant < config.montant_min) throw new BadRequestException('Montant inférieur au minimum autorisé');
    if (config.montant_max != null && montant > config.montant_max) throw new BadRequestException('Montant supérieur au maximum autorisé');
  }

  private async configurationPourPaiement(paiement: Paiement): Promise<ConfigurationPaiement | null> {
    const config = await this.configurations.findOne({
      where: {
        pays: paiement.pays,
        prestataire: paiement.prestataire,
        mode: paiement.mode ?? ModePaiement.SANDBOX,
      },
    });
    if (config) return config;
    const envConfig = this.configurationEnvParDefaut(paiement.pays, paiement.prestataire, paiement.mode)[0];
    return envConfig ? this.configurations.create(envConfig) : null;
  }

  private configurationEnvParDefaut(
    pays: string,
    prestataire?: PrestatairePaiement,
    mode?: ModePaiement,
  ): Partial<ConfigurationPaiement>[] {
    const prestataireDefaut = this.config.get<string>('PAIEMENT_PRESTATAIRE_DEFAUT', 'KKIAPAY') as PrestatairePaiement;
    if (prestataire && ![PrestatairePaiement.KKIAPAY, PrestatairePaiement.FEDAPAY, PrestatairePaiement.STRIPE, PrestatairePaiement.REVENUECAT].includes(prestataire)) return [];
    if (prestataire === PrestatairePaiement.STRIPE || (!prestataire && prestataireDefaut === PrestatairePaiement.STRIPE)) {
      const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
      const publicKey = this.config.get<string>('STRIPE_PUBLIC_KEY');
      if (secretKey) {
        const modeDefaut = mode ?? (this.config.get<string>('PAIEMENT_MODE', ModePaiement.SANDBOX) as ModePaiement);
        return [{
          pays,
          prestataire: PrestatairePaiement.STRIPE,
          mode: modeDefaut,
          devise: this.config.get<string>('STRIPE_DEVISE_DEFAUT', 'EUR'),
          montant_min: null,
          montant_max: null,
          est_actif: true,
          credentials_chiffres: null,
          credentials_masquees: {
            public_key: publicKey ? this.credentials.mask({ public_key: publicKey }).public_key : undefined,
            secret_key: this.credentials.mask({ secret_key: secretKey }).secret_key,
          },
        }];
      }
    }
    if (prestataire === PrestatairePaiement.FEDAPAY || (!prestataire && prestataireDefaut === PrestatairePaiement.FEDAPAY)) {
      const secretKey = this.config.get<string>('FEDAPAY_SECRET_KEY');
      const publicKey = this.config.get<string>('FEDAPAY_PUBLIC_KEY');
      if (secretKey) {
        const modeDefaut = mode ?? (this.config.get<string>('PAIEMENT_MODE', ModePaiement.SANDBOX) as ModePaiement);
        return [{
          pays,
          prestataire: PrestatairePaiement.FEDAPAY,
          mode: modeDefaut,
          devise: this.config.get<string>('PAIEMENT_DEVISE_DEFAUT', 'XOF'),
          montant_min: null,
          montant_max: null,
          est_actif: true,
          credentials_chiffres: null,
          credentials_masquees: {
            public_key: publicKey ? this.credentials.mask({ public_key: publicKey }).public_key : undefined,
            secret_key: this.credentials.mask({ secret_key: secretKey }).secret_key,
          },
        }];
      }
    }
    if (!prestataire && prestataireDefaut !== PrestatairePaiement.KKIAPAY) return [];

    const publicKey = this.config.get<string>('KKIAPAY_PUBLIC_KEY');
    const privateKey = this.config.get<string>('KKIAPAY_PRIVATE_KEY');
    if (!publicKey || !privateKey) return [];

    const modeDefaut = mode ?? (this.config.get<string>('PAIEMENT_MODE', ModePaiement.SANDBOX) as ModePaiement);
    return [{
      pays,
      prestataire: PrestatairePaiement.KKIAPAY,
      mode: modeDefaut,
      devise: this.config.get<string>('PAIEMENT_DEVISE_DEFAUT', 'XOF'),
      montant_min: null,
      montant_max: null,
      est_actif: true,
      credentials_chiffres: null,
      credentials_masquees: {
        public_key: this.credentials.mask({ public_key: publicKey }).public_key,
        private_key: this.credentials.mask({ private_key: privateKey }).private_key,
      },
    }];
  }

  private configurationPublique(config: ConfigurationPaiement) {
    const { credentials_chiffres, ...publique } = config;
    void credentials_chiffres;
    return publique;
  }

  private baseUrlPublique(valeur: string | undefined, fallback: string): string {
    const baseUrl = (valeur || fallback).trim().replace(/\/+$/, '');
    return baseUrl || fallback.replace(/\/+$/, '');
  }

  private async paiementAdmin(pays: string, uuid: string) {
    const paiement = await this.paiements.findOne({ where: { pays, uuid } });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    return paiement;
  }

  private async appliquerStatutVerifie(
    paiement: Paiement,
    statut: StatutPaiement,
    montant: number,
    payload: Record<string, unknown>,
  ) {
    if (statut === StatutPaiement.REUSSI && Number(montant) !== Number(paiement.montant)) {
      throw new BadRequestException('Montant vérifié différent du montant attendu');
    }
    if (RANG_STATUT[statut] < RANG_STATUT[paiement.statut]) {
      this.logger.warn(`Transition ignorée pour ${paiement.uuid}: ${paiement.statut} -> ${statut}`);
      return;
    }
    if (STATUTS_FINAUX.has(paiement.statut)) return;

    paiement.payload_confirmation = payload;
    paiement.statut = statut;
    if (statut === StatutPaiement.REUSSI) paiement.date_confirmation = new Date();
    await this.paiements.save(paiement);
    if (statut === StatutPaiement.REUSSI) {
      // Un paiement vise soit un abonnement, soit une commande de codes.
      if (paiement.commande_id) {
        await this.commandes.honorerCommande(paiement.commande_id, paiement.id);
      } else {
        await this.activerAbonnementPaye(paiement);
      }
    }
  }


  /**
   * Fabrique le paiement d'un achat in-app, que le store a déjà encaissé.
   *
   * Contrairement au mobile money, rien n'a été initié chez nous : on reconstruit
   * la ligne depuis la notification. Trois éléments doivent s'y retrouver, sinon
   * on ne rattache rien plutôt que de deviner :
   *
   *  - `app_user_id` doit être l'uuid d'un compte Edukia ;
   *  - `product_id` doit désigner un plan, via `identifiants_store` ;
   *  - le pays vient du COMPTE, pas du store : « country_code » décrit la
   *    boutique où l'achat a eu lieu, pas le pays d'inscription.
   *
   * Le montant et la devise sont ceux du store — 29,99 USD, et non le prix du
   * plan en XOF. C'est la vérité de la transaction, et `appliquerStatutVerifie`
   * compare ensuite ce montant à lui-même.
   */

  /**
   * Le pendant de `initier()` pour un achat groupé.
   *
   * Même prestataire, même webhook, même cycle : seule la CIBLE change. Le
   * montant vient de la commande — figé à sa création — et non du prix courant
   * du plan, qui peut avoir bougé entre-temps.
   */
  private async initierCommande(pays: string, utilisateurId: number, dto: InitierPaiementDto) {
    // `parUuid` refuse déjà la commande d'autrui, avec le même message qu'une
    // absence : ne pas révéler qu'elle existe.
    const commande = await this.commandes.parUuid(dto.commande_uuid!, utilisateurId);
    if (commande.statut !== StatutCommande.EN_ATTENTE) {
      throw new ConflictException('Seule une commande en attente peut être payée.');
    }

    const config = await this.configurationActive(pays, dto.prestataire);
    const montant = Number(commande.montant_total);
    if (montant <= 0) throw new ConflictException("Cette commande ne nécessite pas de paiement");
    this.verifierPlafonds(config, montant);

    const utilisateur = await this.utilisateurs.findOne({ where: { id: utilisateurId } });
    if (!utilisateur) throw new NotFoundException('Utilisateur introuvable');

    const provider = this.providers.get(config.prestataire);
    const reference = `EDKC-${Date.now()}-${utilisateurId}-${commande.id}`;
    const paiement = await this.paiements.save(this.paiements.create({
      pays,
      reference,
      utilisateur_id: utilisateurId,
      commande_id: commande.id,
      montant,
      devise: config.devise,
      prestataire: config.prestataire,
      mode: config.mode,
      methode: dto.methode ?? MethodePaiement.MOBILE_MONEY,
      statut: StatutPaiement.INITIE,
      date_expiration: new Date(Date.now() + 30 * 60 * 1000),
    }));

    const frontendBaseUrl = this.baseUrlPublique(process.env.FRONTEND_URL, 'https://educ-prime.com');
    const webhookBaseUrl = this.baseUrlPublique(
      process.env.PAIEMENT_WEBHOOK_BASE_URL ?? process.env.API_PUBLIC_URL,
      'https://api.educ-prime.com',
    );
    const resultat = await provider.initier({
      reference,
      mode: config.mode,
      montant,
      devise: config.devise,
      client: {
        nom: [utilisateur.prenom, utilisateur.nom].filter(Boolean).join(' ') || utilisateur.email,
        email: utilisateur.email,
        telephone: dto.telephone ?? utilisateur.telephone,
      },
      urlRetour: `${frontendBaseUrl}/mes-codes?paiement=${paiement.uuid}`,
      urlWebhook: `${webhookBaseUrl}/paiements/webhooks/${config.prestataire.toLowerCase()}`,
      metadata: { paiementUuid: paiement.uuid, commandeUuid: commande.uuid },
      credentials: this.credentials.decrypt(config.credentials_chiffres),
    });

    paiement.statut = StatutPaiement.EN_ATTENTE;
    paiement.reference_prestataire = resultat.referencePrestataire ?? null;
    paiement.url_paiement = resultat.urlPaiement ?? null;
    paiement.token_client = resultat.tokenClient ?? null;
    paiement.payload_initiation = resultat.payload as any;
    const sauvegarde = await this.paiements.save(paiement);
    await this.commandes.lierPaiement(commande.id, sauvegarde.id);
    return sauvegarde;
  }

  /**
   * Traite les événements RevenueCat qui portent sur le cycle de vie de
   * l'abonnement plutôt que sur un encaissement. Renvoie `true` s'il a pris
   * l'événement en charge, `false` pour laisser le chemin d'activation
   * s'occuper des achats et renouvellements.
   */
  private async traiterCycleVieRevenueCat(payload: unknown): Promise<boolean> {
    const event = (payload as any)?.event ?? {};
    const type = String(event.type ?? '').toUpperCase();
    if (type !== 'CANCELLATION' && type !== 'EXPIRATION') return false;

    const uuid = String(event.app_user_id ?? '').trim();
    const identifiantProduit = String(event.product_id ?? '').trim();
    const utilisateur = uuid ? await this.utilisateurs.findOne({ where: { uuid } }) : null;
    if (!utilisateur) {
      this.logger.warn(`Cycle de vie RevenueCat ${type} ignoré : aucun compte pour app_user_id=${uuid}`);
      return true; // pris en charge (rien à faire), pour ne pas retomber sur le chemin d'activation
    }

    const plan = identifiantProduit
      ? await this.plans.findOne({
          where: { pays: utilisateur.pays, identifiants_store: ArrayContains([identifiantProduit]) },
        })
      : null;
    if (!plan) {
      this.logger.warn(`Cycle de vie RevenueCat ${type} ignoré : produit « ${identifiantProduit} » sans plan (${utilisateur.pays})`);
      return true;
    }

    if (type === 'CANCELLATION') {
      await this.abonnementsService.desactiverRenouvellementStore(utilisateur.id, plan.id);
    } else {
      await this.abonnementsService.expirerDepuisStore(utilisateur.id, plan.id);
    }
    return true;
  }

  private async creerPaiementAchatInApp(
    evt: { reference: string; referencePrestataire?: string; montant: number; devise: string; methode?: MethodePaiement },
    payload: unknown,
  ): Promise<Paiement | null> {
    const event = (payload as any)?.event ?? {};
    const identifiantProduit = String(event.product_id ?? '').trim();

    const utilisateur = evt.reference
      ? await this.utilisateurs.findOne({ where: { uuid: evt.reference } })
      : null;
    if (!utilisateur) {
      this.logger.warn(`Achat in-app ignoré : aucun compte pour app_user_id=${evt.reference}`);
      return null;
    }

    const plan = identifiantProduit
      ? await this.plans.findOne({
          where: { pays: utilisateur.pays, identifiants_store: ArrayContains([identifiantProduit]) },
        })
      : null;
    if (!plan) {
      this.logger.warn(
        `Achat in-app ignoré : produit « ${identifiantProduit} » rattaché à aucun plan (${utilisateur.pays}). ` +
          `À renseigner dans Abonnements → Plans.`,
      );
      return null;
    }

    // Réutiliser la souscription en attente plutôt que d'en empiler une : c'est
    // celle que l'utilisateur voit dans l'application.
    const abonnement =
      (await this.abonnements.findOne({
        where: { utilisateur_id: utilisateur.id, plan_id: plan.id, statut: StatutAbonnement.EN_ATTENTE },
        order: { date_creation: 'DESC' },
      })) ??
      (await this.abonnements.save(
        this.abonnements.create({
          pays: utilisateur.pays,
          utilisateur_id: utilisateur.id,
          plan_id: plan.id,
          statut: StatutAbonnement.EN_ATTENTE,
          devise: evt.devise,
          montant_paye: 0,
        }),
      ));

    this.logger.log(
      `Achat in-app rattaché : compte ${utilisateur.id}, plan ${plan.code}, ` +
        `abonnement ${abonnement.uuid}, transaction ${evt.referencePrestataire ?? '?'}`,
    );

    return this.paiements.save(
      this.paiements.create({
        pays: utilisateur.pays,
        // La transaction du store fait référence : elle est stable et unique,
        // là où `app_user_id` se répète à chaque renouvellement.
        reference: evt.referencePrestataire ?? `IAP-${Date.now()}-${utilisateur.id}`,
        reference_prestataire: evt.referencePrestataire ?? null,
        utilisateur_id: utilisateur.id,
        abonnement_id: abonnement.id,
        montant: evt.montant,
        devise: evt.devise,
        prestataire: PrestatairePaiement.REVENUECAT,
        mode: String(event.environment ?? '').toUpperCase() === 'PRODUCTION' ? ModePaiement.LIVE : ModePaiement.SANDBOX,
        methode: evt.methode ?? MethodePaiement.IAP,
        statut: StatutPaiement.EN_ATTENTE,
        payload_initiation: payload as any,
      }),
    );
  }

  private async activerAbonnementPaye(paiement: Paiement) {
    if (!paiement.abonnement_id) return;
    const abonnement = await this.abonnements.findOne({ where: { id: paiement.abonnement_id } });
    if (!abonnement) return;

    // Achat in-app : Apple et Google fixent la période et gèrent le
    // renouvellement. On lit ces vérités dans le payload du store plutôt que
    // de recalculer une échéance sur la durée du plan, qui divergerait dès le
    // premier renouvellement. Les autres prestataires ne renseignent rien et
    // conservent le comportement historique.
    const store = this.donneesStoreRevenueCat(paiement);

    await this.abonnementsService.activerApresPaiement(abonnement.uuid, {
      montant: paiement.montant,
      reference: paiement.reference,
      paiementId: paiement.id,
      prestataire: paiement.prestataire,
      dateFin: store?.dateFin ?? null,
      renouvellementAuto: store?.renouvellementAuto,
    });
  }

  /**
   * Extrait du paiement in-app ce que seul le store connaît : l'échéance
   * (`expiration_at_ms`) et si l'abonnement se renouvelle tout seul. Renvoie
   * `null` pour tout ce qui n'est pas un achat RevenueCat — les autres
   * prestataires n'ont pas ces notions.
   */
  private donneesStoreRevenueCat(
    paiement: Paiement,
  ): { dateFin: Date | null; renouvellementAuto: boolean } | null {
    if (paiement.prestataire !== PrestatairePaiement.REVENUECAT) return null;
    const event = (paiement.payload_initiation as any)?.event ?? {};
    const type = String(event.type ?? '').toUpperCase();

    const ms = Number(event.expiration_at_ms);
    const dateFin = Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;

    // Un achat « non renouvelable » (NON_RENEWING_PURCHASE) est le seul cas
    // in-app qui ne se reconduit pas ; tout le reste est un abonnement.
    const renouvellementAuto = type !== 'NON_RENEWING_PURCHASE';

    return { dateFin, renouvellementAuto };
  }
}
