import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ModePaiement, PrestatairePaiement } from '../shared/paiement.enums';

@Entity('configurations_paiement')
@Index(['pays'])
@Index(['pays', 'prestataire', 'mode'], { unique: true })
export class ConfigurationPaiement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', generated: 'uuid' })
  uuid: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  @Column({ type: 'varchar', length: 30 })
  prestataire: PrestatairePaiement;

  @Column({ type: 'varchar', length: 20, default: ModePaiement.SANDBOX })
  mode: ModePaiement;

  @Column({ type: 'varchar', length: 10, default: 'XOF' })
  devise: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) } })
  montant_min: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) } })
  montant_max: number | null;

  @Column({ type: 'boolean', default: true })
  est_actif: boolean;

  @Column({ type: 'jsonb', nullable: true })
  credentials_chiffres: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  credentials_masquees: Record<string, string> | null;

  @CreateDateColumn({ name: 'date_creation', type: 'timestamptz' })
  date_creation: Date;

  @UpdateDateColumn({ name: 'date_modification', type: 'timestamptz' })
  date_modification: Date;
}
