import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeviceAttestationProvider } from '../dto/device-attestation.dto';

@Entity('appareils_quota_gratuit')
@Index(['provider', 'installationHash'], { unique: true })
export class DeviceCreditInstallation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'fournisseur', type: 'varchar', length: 40 })
  provider: DeviceAttestationProvider;

  @Column({ name: 'plateforme', type: 'varchar', length: 20 })
  platform: 'android' | 'ios';

  @Column({ name: 'installation_hash', type: 'char', length: 64 })
  installationHash: string;

  @Column({ name: 'inscriptions_comptabilisees', type: 'integer', default: 0 })
  registrationCount: number;

  @Column({ name: 'compteur_fournisseur', type: 'integer', default: 0 })
  vendorCount: number;

  @Column({ name: 'derniere_verification', type: 'timestamptz' })
  lastVerifiedAt: Date;

  @CreateDateColumn({ name: 'date_creation', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'date_modification', type: 'timestamptz' })
  updatedAt: Date;
}
