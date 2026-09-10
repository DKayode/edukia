import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RoleType, Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { FeeType, RewardSourceTypeCode, WalletStatus } from '../wallet/shared/payment.enums';
import { PAYMENT_REWARD_CONFIGURATION_REPOSITORY } from '../wallet/shared/payment.tokens';
import type { PaymentRewardConfigurationRepositoryPort } from '../wallet/shared/payment.ports';
import { CreditRewardSourceUseCase } from '../wallet/user-payment/use-cases/credit-reward-source.use-case';
import { Abonnement } from './entities/abonnement.entity';

/** Motif de non-versement, journalisé pour que l'absence de commission s'explique. */
export type MotifRefusCommission =
  | 'AUCUN_PARRAIN'
  | 'DEJA_VERSEE'
  | 'AUTO_PARRAINAGE'
  | 'PARRAIN_INTROUVABLE'
  | 'PARRAIN_DESACTIVE'
  | 'WALLET_INDISPONIBLE';

export type MotifRepriseCommission =
  | 'COMMISSION_NON_VERSEE'
  | 'COMMISSION_INTROUVABLE'
  | 'COMMISSION_DEJA_ANNULEE'
  | 'SOLDE_INSUFFISANT'
  | 'ERREUR_TECHNIQUE';

@Injectable()
export class ParrainageService {
  private readonly logger = new Logger(ParrainageService.name);

  constructor(
    @InjectRepository(Abonnement) private readonly abonnements: Repository<Abonnement>,
    @InjectRepository(Utilisateur) private readonly utilisateurs: Repository<Utilisateur>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Résolution TARDIVE du use-case de crédit.
   *
   * Importer WalletModule ici fermerait un cycle réel :
   * WalletModule → UtilisateursModule → FichiersModule → FilesModule →
   * AbonnementsModule (FilesModule dépend des droits depuis #245).
   * `forwardRef` ne suffit pas — le maillon indéfini est à l'intérieur du
   * wallet. Le résoudre au moment de l'appel supprime l'arête du graphe de
   * modules sans déplacer le versement de commission dans le wallet, qui n'a
   * pas à connaître les abonnements.
   */
  private get creditRewardSource(): CreditRewardSourceUseCase {
    return this.moduleRef.get(CreditRewardSourceUseCase, { strict: false });
  }

  /** Même raison de résolution tardive que ci-dessus. */
  private get configurationsRecompense(): PaymentRewardConfigurationRepositoryPort {
    return this.moduleRef.get(PAYMENT_REWARD_CONFIGURATION_REPOSITORY, { strict: false });
  }

  /**
   * Bénéficiaire de la commission POUR CET ABONNEMENT.
   *
   * **Seul le code présenté à l'achat ouvre droit à une commission.** Sans
   * code, personne n'est crédité — même si l'utilisateur a un parrain
   * d'inscription.
   *
   * La commission récompense l'acte de vente, pas l'acquisition passée : un
   * parrain qui a amené un compte il y a six mois n'a rien fait pour
   * l'abonnement d'aujourd'hui. C'est aussi ce qui rend le code utile — sans
   * lui, il n'y a rien à partager.
   *
   * ⚠️ `utilisateurs.parrain_id` n'est ni lu ni écrit ici. Il reste la donnée
   * d'acquisition, exploitée par les statistiques de parrainage.
   */
  async resoudreParrain(utilisateurId: number, codeSaisi?: string): Promise<number | null> {
    if (!codeSaisi?.trim()) return null;
    const normalise = codeSaisi.trim().toUpperCase();

    // Le registre unifié (#247) fait foi. Le repli sur `mon_code_parrainage`
    // couvre les comptes dont l'enregistrement au registre a échoué — il est
    // best-effort à l'inscription, pour ne pas bloquer la création de compte.
    const [duRegistre] = await this.dataSource.query(
      `SELECT proprietaire_id FROM codes
        WHERE upper(code) = $1 AND est_actif = true AND proprietaire_id IS NOT NULL
        LIMIT 1`,
      [normalise],
    );
    const proprietaire = duRegistre?.proprietaire_id
      ? { id: Number(duRegistre.proprietaire_id) }
      : await this.utilisateurs.findOne({ where: { mon_code_parrainage: normalise }, select: ['id'] });

    // Code inconnu ou son propre code : pas de bénéficiaire, et la souscription
    // se poursuit sans erreur — bloquer un paiement pour une faute de frappe
    // sur un champ facultatif serait absurde.
    if (!proprietaire || proprietaire.id === utilisateurId) return null;
    return proprietaire.id;
  }

  /**
   * Verse la commission au parrain d'un abonnement activé.
   *
   * **Best-effort, comme partout ailleurs dans ce dépôt** : un échec ne doit
   * jamais faire échouer l'activation d'un abonnement déjà payé. Les abonnements
   * restés à `commission_versee = false` sont rattrapables depuis le back-office.
   */
  async verserCommission(abonnement: Abonnement): Promise<{ verse: boolean; motif?: MotifRefusCommission }> {
    const refus = await this.motifDeRefus(abonnement);
    if (refus) {
      this.logger.log(`Commission non versée pour l'abonnement ${abonnement.uuid} : ${refus}`);
      return { verse: false, motif: refus };
    }

    try {
      const resultat = await this.creditRewardSource.execute({
        userId: abonnement.parrain_id,
        sourceType: RewardSourceTypeCode.PARRAINAGE_ABONNEMENT,
        // ⚠️ L'identifiant de l'ABONNEMENT, jamais celui du filleul ni du
        // parrain. Le use-case déduplique sur (wallet, sourceType, sourceId) :
        // avec l'id du filleul, le second parrainage serait silencieusement
        // avalé ; avec celui de l'abonnement, un webhook rejoué ne crédite pas
        // deux fois et deux filleuls créditent bien deux fois.
        sourceId: abonnement.uuid,
        baseAmount: Number(abonnement.montant_paye),
        reference: `PARRAINAGE_ABONNEMENT_REWARD:${abonnement.uuid}`,
        description: `Commission de parrainage — abonnement ${abonnement.uuid}`,
        metadata: {
          filleulId: abonnement.utilisateur_id,
          abonnementUuid: abonnement.uuid,
          montantAbonnement: Number(abonnement.montant_paye),
          planCode: abonnement.plan?.code ?? null,
        },
      });

      if (resultat?.duplicated) {
        this.logger.warn(`Commission déjà créditée pour ${abonnement.uuid} (${resultat.reason})`);
      }

      await this.abonnements.update(abonnement.id, { commission_versee: true });
      return { verse: true };
    } catch (err) {
      // Commission désactivée, taux à zéro, plafond atteint : autant de refus
      // légitimes du wallet. Ils ne doivent pas remonter jusqu'à l'admin qui
      // vient d'encaisser un paiement.
      this.logger.warn(
        `Versement de commission impossible pour ${abonnement.uuid}: ${err?.message ?? err}`,
      );
      return { verse: false };
    }
  }

  /**
   * Reprend la commission d'un abonnement remboursé.
   *
   * La commission d'origine est annulée et un ajustement débiteur est inscrit
   * dans le grand livre. La référence unique rend l'opération rejouable sans
   * débiter deux fois le parrain. Comme le versement, la reprise est
   * best-effort : un solde insuffisant ne doit pas faire échouer le
   * remboursement du client et l'admin pourra relancer l'opération.
   */
  async reprendreCommission(abonnement: Abonnement): Promise<{
    reprise: boolean;
    dupliquee?: boolean;
    montant?: number;
    motif?: MotifRepriseCommission;
  }> {
    if (!abonnement.commission_versee) {
      return { reprise: false, motif: 'COMMISSION_NON_VERSEE' };
    }

    const referenceCommission = `PARRAINAGE_ABONNEMENT_REWARD:${abonnement.uuid}`;
    const referenceReprise = `PARRAINAGE_ABONNEMENT_REFUND:${abonnement.uuid}`;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const [repriseExistante] = await manager.query(
          `SELECT amount FROM wallet_transactions WHERE reference = $1 LIMIT 1`,
          [referenceReprise],
        );
        if (repriseExistante) {
          await manager.query(
            `UPDATE abonnements SET commission_versee = false WHERE id = $1`,
            [abonnement.id],
          );
          return {
            reprise: true,
            dupliquee: true,
            montant: Math.abs(Number(repriseExistante.amount)),
          };
        }

        const [commission] = await manager.query(
          `SELECT wt.id,
                  wt.wallet_id,
                  wt.amount,
                  wt.status,
                  w.available_balance,
                  w.pending_balance
             FROM wallet_transactions wt
             JOIN wallets w ON w.id = wt.wallet_id
            WHERE wt.reference = $1
              AND wt.type = 'REWARD'
              AND wt.reward_source_type_code = $2
            LIMIT 1
            FOR UPDATE OF wt, w`,
          [referenceCommission, RewardSourceTypeCode.PARRAINAGE_ABONNEMENT],
        );
        if (!commission) {
          return { reprise: false, motif: 'COMMISSION_INTROUVABLE' as const };
        }
        if (commission.status === 'CANCELLED') {
          return { reprise: false, motif: 'COMMISSION_DEJA_ANNULEE' as const };
        }

        const montant = Number(commission.amount);
        const disponibleAvant = Number(commission.available_balance);
        const attenteAvant = Number(commission.pending_balance);
        const commissionEnAttente = commission.status === 'PENDING';
        const soldeCible = commissionEnAttente ? attenteAvant : disponibleAvant;
        if (soldeCible < montant) {
          throw new Error('SOLDE_INSUFFISANT');
        }

        const disponibleApres = commissionEnAttente
          ? disponibleAvant
          : disponibleAvant - montant;
        const attenteApres = commissionEnAttente
          ? attenteAvant - montant
          : attenteAvant;
        const soldeAvant = disponibleAvant + attenteAvant;
        const soldeApres = disponibleApres + attenteApres;

        await manager.query(
          `UPDATE wallets
              SET available_balance = $2,
                  pending_balance = $3,
                  version = version + 1,
                  updated_at = NOW()
            WHERE id = $1`,
          [commission.wallet_id, disponibleApres, attenteApres],
        );
        await manager.query(
          `UPDATE wallet_transactions SET status = 'CANCELLED' WHERE id = $1`,
          [commission.id],
        );
        await manager.query(
          `INSERT INTO wallet_transactions (
             wallet_id, type, amount, balance_before, balance_after,
             available_balance_after, pending_balance_after, reference,
             description, status, metadata
           ) VALUES ($1, 'ADJUSTMENT', $2, $3, $4, $5, $6, $7, $8, 'COMPLETED', $9::jsonb)`,
          [
            commission.wallet_id,
            -montant,
            soldeAvant,
            soldeApres,
            disponibleApres,
            attenteApres,
            referenceReprise,
            `Reprise de commission - abonnement rembourse ${abonnement.uuid}`,
            JSON.stringify({
              operation: 'REPRISE_COMMISSION_REMBOURSEMENT',
              abonnementUuid: abonnement.uuid,
              transactionCommissionId: commission.id,
              referenceCommission,
            }),
          ],
        );
        await manager.query(
          `UPDATE abonnements SET commission_versee = false WHERE id = $1`,
          [abonnement.id],
        );

        return { reprise: true, montant };
      });
    } catch (err) {
      const motif: MotifRepriseCommission = err?.message === 'SOLDE_INSUFFISANT'
        ? 'SOLDE_INSUFFISANT'
        : 'ERREUR_TECHNIQUE';
      this.logger.warn(
        `Reprise de commission impossible pour ${abonnement.uuid}: ${err?.message ?? err}`,
      );
      return { reprise: false, motif };
    }
  }

  private async motifDeRefus(abonnement: Abonnement): Promise<MotifRefusCommission | null> {
    if (!abonnement.parrain_id) return 'AUCUN_PARRAIN';
    if (abonnement.commission_versee) return 'DEJA_VERSEE';
    if (abonnement.parrain_id === abonnement.utilisateur_id) return 'AUTO_PARRAINAGE';

    const parrain = await this.utilisateurs.findOne({
      where: { id: abonnement.parrain_id },
      select: ['id', 'est_desactive'],
    });
    if (!parrain) return 'PARRAIN_INTROUVABLE';
    if (parrain.est_desactive) return 'PARRAIN_DESACTIVE';

    // Un wallet bloqué ou clos ne peut rien recevoir : créditer produirait une
    // ligne que le parrain ne pourra jamais retirer.
    const [wallet] = await this.dataSource.query(
      `SELECT status FROM wallets WHERE user_id = $1 LIMIT 1`,
      [abonnement.parrain_id],
    );
    if (wallet && [WalletStatus.BLOCKED, WalletStatus.CLOSED].includes(wallet.status)) {
      return 'WALLET_INDISPONIBLE';
    }

    return null;
  }

  /**
   * Réglage de la commission, lu depuis la configuration de récompense du
   * wallet — même source que le versement, pour qu'il n'y ait jamais deux
   * vérités sur le taux.
   */
  async reglageCommission() {
    const config = await this.configurationsRecompense.getActiveBySourceTypeCode(
      RewardSourceTypeCode.PARRAINAGE_ABONNEMENT,
    );
    return {
      taux: Number(config.commissionPercentage ?? 0),
      est_active: !!config.rewardEnabled,
      devise: config.currency,
      // Un taux à 0 ne verse rien même « activé » : le dire évite de croire la
      // fonctionnalité en marche.
      verse_effectivement: !!config.rewardEnabled && Number(config.commissionPercentage ?? 0) > 0,
    };
  }

  async modifierCommission(champs: { taux?: number; est_active?: boolean }, adminId?: number) {
    await this.configurationsRecompense.updateBySourceTypeCode(
      RewardSourceTypeCode.PARRAINAGE_ABONNEMENT,
      {
        ...(champs.taux !== undefined
          ? { commissionPercentage: champs.taux, commissionType: FeeType.PERCENTAGE, rewardAmount: 0 }
          : {}),
        ...(champs.est_active !== undefined ? { rewardEnabled: champs.est_active } : {}),
      } as any,
      adminId ?? 0,
    );
    const reglage = await this.reglageCommission();
    this.logger.log(
      `Commission de parrainage : taux=${reglage.taux}% active=${reglage.est_active}`,
    );
    return reglage;
  }

  /**
   * Classement des bénéficiaires de commissions sur une période.
   *
   * Agrégé en SQL plutôt qu'en mémoire : le classement porte sur toutes les
   * transactions de commission, dont le volume n'a aucune raison de tenir dans
   * une page.
   *
   * `wallet_transactions.created_at` fait foi, et non la date de l'abonnement :
   * une commission rattrapée appartient au mois où elle a été versée, sinon les
   * totaux d'une période close changeraient après coup.
   */
  async classementCommissions(params: { startDate?: string; endDate?: string; limit?: number }) {
    const limite = Math.min(params.limit ?? 20, 100);
    const conditions: string[] = [
      `wt.reward_source_type_code = $1`,
      `wt.status <> 'CANCELLED'`,
    ];
    const valeurs: any[] = [RewardSourceTypeCode.PARRAINAGE_ABONNEMENT];

    if (params.startDate) {
      valeurs.push(params.startDate);
      conditions.push(`wt.created_at >= $${valeurs.length}::date`);
    }
    if (params.endDate) {
      valeurs.push(params.endDate);
      // Borne de fin INCLUSE : `<= endDate` seul exclurait toute la journée,
      // puisque created_at porte une heure.
      conditions.push(`wt.created_at < ($${valeurs.length}::date + interval '1 day')`);
    }
    valeurs.push(limite);

    const lignes = await this.dataSource.query(
      `SELECT u.id,
              u.uuid,
              u.nom,
              u.prenom,
              u.email,
              u.mon_code_parrainage                      AS code,
              COUNT(*)::int                              AS nombre_commissions,
              COALESCE(SUM(wt.amount), 0)::float         AS total,
              COUNT(DISTINCT wt.reward_source_id)::int   AS abonnements,
              MAX(wt.created_at)                         AS derniere
         FROM wallet_transactions wt
         JOIN wallets w       ON w.id = wt.wallet_id
         JOIN utilisateurs u  ON u.id = w.user_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY u.id, u.uuid, u.nom, u.prenom, u.email, u.mon_code_parrainage
        ORDER BY total DESC, nombre_commissions DESC
        LIMIT $${valeurs.length}`,
      valeurs,
    );

    const [totaux] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT w.user_id)::int        AS beneficiaires,
              COALESCE(SUM(wt.amount), 0)::float    AS total,
              COUNT(*)::int                         AS nombre
         FROM wallet_transactions wt
         JOIN wallets w ON w.id = wt.wallet_id
        WHERE ${conditions.join(' AND ')}`,
      valeurs.slice(0, -1),
    );

    return {
      periode: { startDate: params.startDate ?? null, endDate: params.endDate ?? null },
      totaux: {
        beneficiaires: Number(totaux?.beneficiaires ?? 0),
        nombre_commissions: Number(totaux?.nombre ?? 0),
        total: Number(totaux?.total ?? 0),
      },
      classement: lignes.map((l: any, i: number) => ({
        rang: i + 1,
        uuid: l.uuid,
        nom: l.nom,
        prenom: l.prenom,
        email: l.email,
        code: l.code,
        nombre_commissions: Number(l.nombre_commissions),
        abonnements: Number(l.abonnements),
        total: Number(l.total),
        derniere: l.derniere,
      })),
    };
  }

  /** Vue « mes parrainages » : filleuls, abonnements payants, commissions perçues. */
  async mesParrainages(utilisateurId: number) {
    const [filleuls] = await Promise.all([
      this.utilisateurs.find({
        where: { parrain: { id: utilisateurId } } as any,
        select: ['id', 'uuid', 'nom', 'prenom', 'date_creation'],
        order: { date_creation: 'DESC' },
        take: 100,
      }),
    ]);

    const [totaux] = await this.dataSource.query(
      `SELECT COALESCE(SUM(wt.amount), 0)::float AS total, COUNT(*)::int AS nombre
         FROM wallet_transactions wt
         JOIN wallets w ON w.id = wt.wallet_id
        WHERE w.user_id = $1
          AND wt.reward_source_type_code = $2
          AND wt.status <> 'CANCELLED'`,
      [utilisateurId, RewardSourceTypeCode.PARRAINAGE_ABONNEMENT],
    );

    const abonnes = await this.abonnements.count({
      where: { parrain_id: utilisateurId, commission_versee: true },
    });

    return {
      // Le code du parrain est déjà exposé par /utilisateurs/code-parrainage ;
      // on ne le duplique pas ici.
      filleuls: filleuls.map((f) => ({
        uuid: f.uuid,
        nom: f.nom,
        prenom: f.prenom,
        inscrit_le: f.date_creation,
      })),
      nombre_filleuls: filleuls.length,
      filleuls_abonnes: abonnes,
      commissions: {
        nombre: Number(totaux?.nombre ?? 0),
        total: Number(totaux?.total ?? 0),
      },
    };
  }
}
