import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Utilisateur } from '../../utilisateurs/entities/utilisateur.entity';
import { CampagneCode } from './campagne-code.entity';
import { CodeEffet } from './code-effet.entity';

/**
 * D'où vient le code — et non ce qu'il fait, qui relève de `code_effets`.
 *
 * C'est la seule chose qui distinguait réellement un « parrainage » d'un
 * « ambassadeur » : les deux versent une commission.
 */
export enum OrigineCode {
  /** Généré automatiquement à la création d'un compte. */
  INSCRIPTION = 'INSCRIPTION',
  /** Créé au back-office, seul ou par campagne. */
  ADMIN = 'ADMIN',
  /**
   * Engendré par un achat groupé d'abonnements.
   *
   * La distinction n'est pas cosmétique : elle autorise l'acheteur à utiliser
   * un de ses propres codes, ce qu'interdit la règle d'auto-utilisation posée
   * pour le parrainage — où s'auto-parrainer n'aurait aucun sens.
   */
  ACHAT = 'ACHAT',
}

@Entity('codes')
@Index(['origine'])
export class Code {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', generated: 'uuid' })
  uuid: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  /** Unique sans tenir compte de la casse — voir l'index `uq_codes_code`. */
  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 20, default: OrigineCode.ADMIN })
  origine: OrigineCode;

  /** Bénéficiaire d'un éventuel effet COMMISSION. */
  @Column({ type: 'int', nullable: true })
  proprietaire_id: number | null;

  @ManyToOne(() => Utilisateur, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'proprietaire_id' })
  proprietaire: Utilisateur | null;

  @OneToMany(() => CodeEffet, (effet) => effet.code, { cascade: true, eager: true })
  effets: CodeEffet[];

  @Column({ type: 'varchar', length: 150, nullable: true })
  libelle: string | null;

  /** `null` = illimité. C'est le « pour n personnes » de l'issue. */
  @Column({ type: 'int', nullable: true })
  usage_max_total: number | null;

  @Column({ type: 'int', default: 1 })
  usage_max_par_utilisateur: number;

  /** Compteur dénormalisé ; `codes_utilisations` reste la source de vérité. */
  @Column({ type: 'int', default: 0 })
  usage_actuel: number;

  @Column({ type: 'timestamptz', nullable: true })
  date_debut: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  date_fin: Date | null;

  /** `null` = tous les plans. */
  @Column({ type: 'int', array: true, nullable: true })
  plans_eligibles: number[] | null;

  @Column({ type: 'boolean', default: true })
  est_actif: boolean;

  @Column({ type: 'int', nullable: true })
  campagne_id: number | null;

  /** La commande qui a engendré ce code, pour les codes d'origine ACHAT. */
  @Column({ type: 'int', nullable: true })
  commande_id: number | null;

  @ManyToOne(() => CampagneCode, { nullable: true })
  @JoinColumn({ name: 'campagne_id' })
  campagne: CampagneCode | null;

  @Column({ type: 'int', nullable: true })
  cree_par: number | null;

  @CreateDateColumn({ name: 'date_creation', type: 'timestamptz' })
  date_creation: Date;

  @UpdateDateColumn({ name: 'date_modification', type: 'timestamptz' })
  date_modification: Date;
}
