import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeviceAttestationProvider } from '../dto/device-attestation.dto';
import { DeviceCreditControlMode } from '../device-credit.types';

export type DeviceCreditEligibilityStatus =
  | 'ACCORDEE'
  | 'REFUSEE'
  | 'OBSERVATION'
  | 'SANS_PREUVE'
  | 'ERREUR_PREUVE'
  | 'DECISION_ADMIN';

@Entity('eligibilites_quota_gratuit')
@Index(['userId'], { unique: true })
export class DeviceCreditEligibility {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'utilisateur_id', type: 'integer' })
  userId: number;

  @Column({ name: 'appareil_id', type: 'uuid', nullable: true })
  deviceId?: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  @Column({ name: 'fournisseur', type: 'varchar', length: 40, nullable: true })
  provider?: DeviceAttestationProvider;

  @Column({ name: 'mode_controle', type: 'varchar', length: 20 })
  mode: DeviceCreditControlMode;

  @Column({ type: 'varchar', length: 30 })
  status: DeviceCreditEligibilityStatus;

  @Column({ type: 'boolean' })
  eligible: boolean;

  @Column({ name: 'compteur_apres', type: 'integer', nullable: true })
  countAfter?: number;

  @Column({ type: 'varchar', length: 80 })
  reason: string;

  @Column({ name: 'admin_modification_id', type: 'integer', nullable: true })
  adminModificationId?: number;

  @CreateDateColumn({ name: 'date_creation', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'date_modification', type: 'timestamptz' })
  updatedAt: Date;
}
