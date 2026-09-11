import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('configurations_abonnement')
export class ConfigurationAbonnement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', generated: 'uuid', unique: true })
  uuid: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  @Column({ type: 'boolean' })
  verrou_actif: boolean;

  /** Qui a actionné l'interrupteur. Null si le compte a été supprimé depuis. */
  @Column({ type: 'int', nullable: true })
  modifie_par: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  date_creation: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  date_modification: Date;
}
