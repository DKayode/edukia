import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
    private readonly providers: PaiementProviderRegistry,
    private readonly abonnementsService: AbonnementsService,
    private readonly parrainageService: ParrainageService,
    private readonly credentials: PaiementCredentialsService,
    private readonly dataSource: DataSource,
  ) {}

  async prestatairesDisponibles(pays: string) {
    const configurations = await this.configurations.find({
      where: { pays, est_actif: true },
      order: { prestataire: 'ASC' },
    });

    return {
      pays,
      prestataires: configurations.flatMap((configuration) => {
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
      methode: dto.methode ?? MethodePaiement.MOBILE_MONEY,
      statut: StatutPaiement.INITIE,
      date_expiration: expiration,
    }));

    const baseUrl = process.env.PAIEMENT_WEBHOOK_BASE_URL ?? process.env.FRONTEND_URL ?? '';
    const retour = `${process.env.FRONTEND_URL ?? ''}/abonnements?paiement=${paiement.uuid}`;
    const resultat = await provider.initier({
      reference,
      montant,
      devise: config.devise,
      client: {
        nom: [utilisateur.prenom, utilisateur.nom].filter(Boolean).join(' ') || utilisateur.email,
        email: utilisateur.email,
        telephone: dto.telephone ?? utilisateur.telephone,
      },
      urlRetour: retour,
      urlWebhook: `${baseUrl}/paiements/webhooks/${config.prestataire.toLowerCase()}`,
      metadata: { paiementUuid: paiement.uuid, abonnementUuid: abonnement.uuid },
      credentials: this.credentials.decrypt(config.credentials_chiffres),
    });

    paiement.statut = StatutPaiement.EN_ATTENTE;
    paiement.reference_prestataire = resultat.referencePrestataire;
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
    const configs = await this.configurations.find({ where: { pays }, order: { prestataire: 'ASC' } });
    return configs.map((config) => this.configurationPublique(config));
  }

  async configurerPrestataire(
    pays: string,
    dto: {
      prestataire: PrestatairePaiement;
      mode?: ModePaiement;
      devise?: string;
      montant_min?: number;
      montant_max?: number;
      est_actif?: boolean;
      credentials?: Record<string, string>;
    },
  ) {
    const existante = await this.configurations.findOne({ where: { pays, prestataire: dto.prestataire } });
    const config = existante ?? this.configurations.create({ pays, prestataire: dto.prestataire });
    config.mode = dto.mode ?? config.mode ?? ModePaiement.SANDBOX;
    config.devise = dto.devise ?? config.devise ?? 'XOF';
    config.montant_min = dto.montant_min ?? config.montant_min ?? null;
    config.montant_max = dto.montant_max ?? config.montant_max ?? null;
    config.est_actif = dto.est_actif ?? config.est_actif ?? false;

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      const existants = this.credentials.decrypt(config.credentials_chiffres);
      const fusion = { ...existants, ...dto.credentials };
      config.credentials_chiffres = this.credentials.encrypt(fusion);
      config.credentials_masquees = this.credentials.mask(fusion);
    }

    return this.dataSource.transaction(async (manager) => {
      if (config.est_actif) {
        await manager.getRepository(ConfigurationPaiement).update({ pays, est_actif: true }, { est_actif: false });
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
    const config = await this.configurations.findOne({ where: { pays, prestataire: paiement.prestataire } });
    const provider = this.providers.get(paiement.prestataire);
    const statut = await provider.verifierStatut(paiement.reference_prestataire, this.credentials.decrypt(config?.credentials_chiffres));
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
    const paiement = await this.paiements.findOne({
      where: evt.referencePrestataire
        ? { prestataire, reference_prestataire: evt.referencePrestataire }
        : { prestataire, reference: evt.reference },
    });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    if (STATUTS_FINAUX.has(paiement.statut)) return;

    const config = await this.configurations.findOne({ where: { pays: paiement.pays, prestataire: paiement.prestataire } });
    const statutVerifie = paiement.reference_prestataire
      ? await provider.verifierStatut(paiement.reference_prestataire, this.credentials.decrypt(config?.credentials_chiffres))
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
        const config = await this.configurations.findOne({ where: { pays: paiement.pays, prestataire: paiement.prestataire } });
        const provider = this.providers.get(paiement.prestataire);
        const statut = await provider.verifierStatut(paiement.reference_prestataire, this.credentials.decrypt(config?.credentials_chiffres));
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
    if (!config) {
      throw new ServiceUnavailableException({
        code: 'PAIEMENT_INDISPONIBLE',
        message: 'Le paiement en ligne est temporairement indisponible',
      });
    }
    return config;
  }

  private verifierPlafonds(config: ConfigurationPaiement, montant: number) {
    if (config.montant_min != null && montant < config.montant_min) throw new BadRequestException('Montant inférieur au minimum autorisé');
    if (config.montant_max != null && montant > config.montant_max) throw new BadRequestException('Montant supérieur au maximum autorisé');
  }

  private configurationPublique(config: ConfigurationPaiement) {
    const { credentials_chiffres, ...publique } = config;
    void credentials_chiffres;
    return publique;
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
    if (Number(montant) !== Number(paiement.montant)) {
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
    if (statut === StatutPaiement.REUSSI) await this.activerAbonnementPaye(paiement);
  }

  private async activerAbonnementPaye(paiement: Paiement) {
    if (!paiement.abonnement_id) return;
    const abonnement = await this.abonnements.findOne({ where: { id: paiement.abonnement_id } });
    if (!abonnement) return;
    await this.abonnementsService.activerApresPaiement(abonnement.uuid, {
      montant: paiement.montant,
      reference: paiement.reference,
      paiementId: paiement.id,
      prestataire: paiement.prestataire,
    });
  }
}
