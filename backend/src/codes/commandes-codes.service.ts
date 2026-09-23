import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlanAbonnement } from '../abonnements/entities/plan-abonnement.entity';
import { Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { MailService } from '../mail/mail.service';
import { CommandeCode, StatutCommande } from './entities/commande-code.entity';
import { Code, OrigineCode } from './entities/code.entity';
import { Effet } from './entities/code-effet.entity';

/** Sans I, O, 0 ni 1 : ces caractères se confondent quand on dicte un code. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class CommandesCodesService {
  private readonly logger = new Logger(CommandesCodesService.name);

  /** Au-delà, c'est une négociation commerciale, pas un achat en libre-service. */
  static readonly QUANTITE_MAX = 500;

  constructor(
    @InjectRepository(CommandeCode) private readonly commandes: Repository<CommandeCode>,
    @InjectRepository(PlanAbonnement) private readonly plans: Repository<PlanAbonnement>,
    @InjectRepository(Utilisateur) private readonly utilisateurs: Repository<Utilisateur>,
    @InjectRepository(Code) private readonly codes: Repository<Code>,
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
  ) {}

  /**
   * Enregistre l'intention d'acheter N abonnements.
   *
   * Aucun code n'est créé ici : ils naissent au paiement confirmé. Un panier
   * abandonné ne doit pas laisser d'abonnements gratuits dans la nature.
   */
  async creer(pays: string, utilisateurId: number, dto: { plan_uuid: string; quantite: number }) {
    if (!Number.isInteger(dto.quantite) || dto.quantite < 1) {
      throw new BadRequestException('La quantité doit être un entier positif.');
    }
    if (dto.quantite > CommandesCodesService.QUANTITE_MAX) {
      throw new BadRequestException(
        `Au-delà de ${CommandesCodesService.QUANTITE_MAX} codes, contactez-nous : c'est une commande sur mesure.`,
      );
    }

    const plan = await this.plans.findOne({ where: { uuid: dto.plan_uuid, pays } });
    if (!plan) throw new NotFoundException('Plan introuvable');
    if (!plan.est_actif) throw new ConflictException("Ce plan n'est pas disponible à la vente.");

    // Le prix est figé maintenant : le tarif peut changer avant le paiement, et
    // l'acheteur doit payer ce qu'on lui a annoncé.
    const commande = await this.commandes.save(
      this.commandes.create({
        pays,
        utilisateur_id: utilisateurId,
        plan_id: plan.id,
        quantite: dto.quantite,
        prix_unitaire: Number(plan.prix),
        montant_total: Number(plan.prix) * dto.quantite,
        devise: plan.devise,
        statut: StatutCommande.EN_ATTENTE,
      }),
    );

    this.logger.log(
      `Commande ${commande.uuid} : ${dto.quantite} × ${plan.code} = ${commande.montant_total} ${plan.devise} ` +
        `(utilisateur ${utilisateurId})`,
    );
    return this.parUuid(commande.uuid, utilisateurId);
  }

  async parUuid(uuid: string, utilisateurId?: number): Promise<CommandeCode> {
    const commande = await this.commandes.findOne({ where: { uuid } });
    if (!commande) throw new NotFoundException('Commande introuvable');
    if (utilisateurId !== undefined && commande.utilisateur_id !== utilisateurId) {
      // Même message qu'une absence : ne pas révéler qu'une commande existe.
      throw new NotFoundException('Commande introuvable');
    }
    return commande;
  }

  /** Les commandes de l'acheteur, la plus récente d'abord. */
  async mesCommandes(utilisateurId: number, pays: string) {
    const commandes = await this.commandes.find({
      where: { utilisateur_id: utilisateurId, pays },
      order: { date_creation: 'DESC' },
    });
    return Promise.all(
      commandes.map(async (c) => ({
        uuid: c.uuid,
        statut: c.statut,
        quantite: c.quantite,
        prix_unitaire: c.prix_unitaire,
        montant_total: c.montant_total,
        devise: c.devise,
        plan: { code: c.plan?.code, libelle: c.plan?.libelle },
        date_creation: c.date_creation,
        date_paiement: c.date_paiement,
        codes_generes: c.statut === StatutCommande.PAYEE
          ? await this.codes.count({ where: { commande_id: c.id } })
          : 0,
      })),
    );
  }

  /** Rattache le paiement à la commande, sans changer son statut. */
  async lierPaiement(commandeId: number, paiementId: number): Promise<void> {
    await this.commandes.update(commandeId, { paiement_id: paiementId });
  }

  /**
   * Engendre les codes d'une commande payée, puis les envoie par courriel.
   *
   * Appelé par le module paiements à la confirmation. IDEMPOTENT : un webhook
   * rejoué ne doit pas doubler la livraison, et les prestataires en rejouent.
   */
  async honorerCommande(commandeId: number, paiementId: number): Promise<number> {
    const commande = await this.commandes.findOne({ where: { id: commandeId } });
    if (!commande) {
      this.logger.warn(`Commande ${commandeId} introuvable : paiement ${paiementId} sans effet.`);
      return 0;
    }
    if (commande.statut === StatutCommande.PAYEE) {
      this.logger.log(`Commande ${commande.uuid} déjà honorée : livraison ignorée.`);
      return 0;
    }

    const codes = await this.engendrerCodes(commande);

    commande.statut = StatutCommande.PAYEE;
    commande.paiement_id = paiementId;
    commande.date_paiement = new Date();
    await this.commandes.save(commande);

    // L'envoi vient APRÈS l'enregistrement : un serveur de courriel indisponible
    // ne doit pas faire perdre des codes déjà payés.
    await this.envoyerParCourriel(commande, codes).catch((err) =>
      this.logger.error(
        `Commande ${commande.uuid} honorée mais courriel non envoyé : ${err?.message ?? err}. ` +
          `Les codes restent consultables depuis l'application.`,
      ),
    );

    this.logger.log(`Commande ${commande.uuid} honorée : ${codes.length} code(s) livré(s).`);
    return codes.length;
  }

  private async engendrerCodes(commande: CommandeCode): Promise<string[]> {
    const crees: string[] = [];

    // Plusieurs passes : une collision sur un code déjà pris est possible, et
    // `ON CONFLICT DO NOTHING` la rend silencieuse. On recompte à chaque tour.
    for (let tentative = 0; tentative < 10 && crees.length < commande.quantite; tentative++) {
      const manquants = commande.quantite - crees.length;
      const candidats = Array.from({ length: manquants }, () => this.genererCode());

      const params: any[] = [];
      const lignes = candidats.map((code) => {
        params.push(commande.pays, code, commande.utilisateur_id, commande.id, commande.plan_id);
        const i = params.length - 5;
        return `($${i + 1}, $${i + 2}, 'ACHAT', $${i + 3}, 1, 1, $${i + 4}, ARRAY[$${i + 5}::int], true)`;
      });

      const inseres = await this.dataSource.query(
        `INSERT INTO codes (pays, code, origine, proprietaire_id, usage_max_total,
                            usage_max_par_utilisateur, commande_id, plans_eligibles, est_actif)
         VALUES ${lignes.join(',')}
         ON CONFLICT DO NOTHING
         RETURNING id, code`,
        params,
      );

      if (inseres.length) {
        // Chaque code ouvre un abonnement sans encaissement : c'est déjà payé.
        const p: any[] = [];
        const v = inseres.map((c: any) => {
          p.push(c.id, Effet.ABONNEMENT_OFFERT, JSON.stringify({ duree_jours: null }));
          const i = p.length - 3;
          return `($${i + 1}, $${i + 2}, $${i + 3}::jsonb)`;
        });
        await this.dataSource.query(
          `INSERT INTO code_effets (code_id, effet, parametres) VALUES ${v.join(',')} ON CONFLICT DO NOTHING`,
          p,
        );
        crees.push(...inseres.map((c: any) => c.code));
      }
    }

    if (crees.length < commande.quantite) {
      // Livrer moins que payé est un incident : il doit être visible, pas tu.
      this.logger.error(
        `Commande ${commande.uuid} : ${crees.length}/${commande.quantite} codes générés ` +
          `après 10 tentatives. Collisions répétées — à compléter manuellement.`,
      );
    }
    return crees;
  }

  private genererCode(): string {
    const corps = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    return `EDK-${corps}`;
  }

  private async envoyerParCourriel(commande: CommandeCode, codes: string[]): Promise<void> {
    const acheteur = await this.utilisateurs.findOne({ where: { id: commande.utilisateur_id } });
    if (!acheteur?.email) {
      this.logger.warn(`Commande ${commande.uuid} : aucun courriel pour l'acheteur.`);
      return;
    }

    const plan = commande.plan?.libelle ?? commande.plan?.code ?? 'abonnement';
    const liste = codes.map((c) => `<li style="font-family:monospace;font-size:16px;letter-spacing:1px">${c}</li>`).join('');

    await this.mail.sendPersonalizedEmail(
      acheteur.email,
      `Vos ${codes.length} code${codes.length > 1 ? 's' : ''} d'abonnement Edukia`,
      `<p>Bonjour ${acheteur.prenom ?? ''},</p>
       <p>Votre commande de <strong>${codes.length} ${plan}</strong> est confirmée.</p>
       <p>Voici vos codes. Chacun ouvre un abonnement pour une personne, et ne peut servir qu'une fois :</p>
       <ul>${liste}</ul>
       <p>Pour l'utiliser, il suffit de le saisir au moment de souscrire dans l'application.</p>
       <p>Vous retrouverez à tout moment la liste de vos codes et leur état — utilisés ou non — depuis
          votre espace personnel.</p>`,
    );
    this.logger.log(`Commande ${commande.uuid} : ${codes.length} code(s) envoyé(s) à ${acheteur.email}`);
  }
}
