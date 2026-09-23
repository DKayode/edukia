import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PlanAbonnement } from '../../abonnements/entities/plan-abonnement.entity';
import { Utilisateur } from '../../utilisateurs/entities/utilisateur.entity';

export enum StatutCommande {
  EN_ATTENTE = 'EN_ATTENTE',
  PAYEE = 'PAYEE',
  ANNULEE = 'ANNULEE',
  REMBOURSEE = 'REMBOURSEE',
}

/**
 * Achat groupé d'abonnements, distribué sous forme de codes à usage unique.
 *
 * Une école dote ses élèves, un parent équipe ses enfants, une entreprise ses
 * employés : on paie N abonnements d'un coup et on reçoit N codes à donner.
 *
 * La commande ne crée RIEN tant qu'elle n'est pas payée. Les codes naissent à
 * la confirmation du paiement, jamais avant — sinon un abandon de panier
 * laisserait des abonnements gratuits dans la nature.
 */
@Entity('commandes_codes')
export class CommandeCode {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', generated: 'uuid', unique: true })
  uuid: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  @Column({ type: 'int' })
  utilisateur_id: number;

  @ManyToOne(() => Utilisateur, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'utilisateur_id' })
  utilisateur: Utilisateur;

  @Column({ type: 'int' })
  plan_id: number;

  @ManyToOne(() => PlanAbonnement, { eager: true })
  @JoinColumn({ name: 'plan_id' })
  plan: PlanAbonnement;

  @Column({ type: 'int' })
  quantite: number;

  /**
   * Prix du plan AU MOMENT DE LA COMMANDE.
   *
   * Figé volontairement : le tarif peut changer entre la commande et le
   * paiement, et l'acheteur doit payer ce qu'on lui a annoncé.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: { to: (v: number) => v, from: (v: string) => (v === null ? null : Number(v)) } })
  prix_unitaire: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: { to: (v: number) => v, from: (v: string) => (v === null ? null : Number(v)) } })
  montant_total: number;

  @Column({ type: 'varchar', length: 10, default: 'XOF' })
  devise: string;

  @Column({ type: 'varchar', length: 30, default: StatutCommande.EN_ATTENTE })
  statut: StatutCommande;

  @Column({ type: 'int', nullable: true })
  paiement_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  date_paiement: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  date_creation: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  date_modification: Date;
}
