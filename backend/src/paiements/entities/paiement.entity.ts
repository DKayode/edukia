import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { MethodePaiement, ModePaiement, PrestatairePaiement, StatutPaiement } from '../shared/paiement.enums';

@Entity('paiements')
@Index(['utilisateur_id'])
@Index(['abonnement_id'])
@Index(['statut'])
@Index(['pays'])
export class Paiement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', generated: 'uuid' })
  uuid: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  reference: string;

  @Column({ type: 'int' })
  utilisateur_id: number;

  @Column({ type: 'int', nullable: true })
  abonnement_id: number | null;

  /**
   * La commande groupée payée, quand il ne s'agit pas d'un abonnement.
   *
   * Exclusif de `abonnement_id` : un paiement vise soit un abonnement pour soi,
   * soit un lot de codes à distribuer.
   */
  @Column({ type: 'int', nullable: true })
  commande_id: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: { to: (v: number) => v, from: (v: string) => Number(v ?? 0) } })
  montant: number;

  @Column({ type: 'varchar', length: 10, default: 'XOF' })
  devise: string;

  @Column({ type: 'varchar', length: 30 })
  prestataire: PrestatairePaiement;

  @Column({ type: 'varchar', length: 20, default: ModePaiement.SANDBOX })
  mode: ModePaiement;

  @Column({ type: 'varchar', length: 30, nullable: true })
  methode: MethodePaiement | null;

  @Column({ type: 'varchar', length: 30, default: StatutPaiement.INITIE })
  statut: StatutPaiement;

  @Column({ type: 'varchar', length: 150, nullable: true })
  reference_prestataire: string | null;

  @Column({ type: 'text', nullable: true })
  url_paiement: string | null;

  @Column({ type: 'text', nullable: true })
  token_client: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload_initiation: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  payload_confirmation: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  message_erreur: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  date_expiration: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  date_confirmation: Date | null;

  @CreateDateColumn({ name: 'date_creation', type: 'timestamptz' })
  date_creation: Date;

  @UpdateDateColumn({ name: 'date_modification', type: 'timestamptz' })
  date_modification: Date;
}
