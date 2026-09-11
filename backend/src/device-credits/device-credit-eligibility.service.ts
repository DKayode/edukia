import { createHmac } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSourceResolver } from '../config/data-source-resolver.service';
import { AndroidPlayIntegrityProvider } from './android-play-integrity.provider';
import { AppleDeviceCheckProvider } from './apple-device-check.provider';
import {
  DeviceCreditAllocation,
  DeviceCreditControlMode,
  DeviceProofVerifier,
  PreparedDeviceCreditDecision,
  RegistrationBinding,
  VerifiedDeviceProof,
} from './device-credit.types';
import {
  DeviceAttestationDto,
  DeviceAttestationProvider,
} from './dto/device-attestation.dto';
import { DeviceCreditEligibility } from './entities/device-credit-eligibility.entity';

@Injectable()
export class DeviceCreditEligibilityService {
  private readonly logger = new Logger(DeviceCreditEligibilityService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly resolver: DataSourceResolver,
    private readonly android: AndroidPlayIntegrityProvider,
    private readonly ios: AppleDeviceCheckProvider,
    @InjectRepository(DeviceCreditEligibility)
    private readonly eligibilityRepository: Repository<DeviceCreditEligibility>,
  ) {}

  get mode(): DeviceCreditControlMode {
    const configured = String(
      this.config.get('DEVICE_CREDIT_CONTROL_MODE') ?? 'off',
    ).toLowerCase();
    return configured === 'monitor' || configured === 'enforce'
      ? configured
      : 'off';
  }

  get maxEligibleAccounts(): number {
    const configured = Number(
      this.config.get('DEVICE_CREDIT_MAX_ACCOUNTS') ?? 3,
    );
    // Apple DeviceCheck exposes two bits, so the portable counter cannot exceed 3.
    return Number.isInteger(configured) && configured >= 1 && configured <= 3
      ? configured
      : 3;
  }

  async prepare(
    attestation: DeviceAttestationDto | undefined,
    binding: RegistrationBinding,
  ): Promise<PreparedDeviceCreditDecision> {
    const mode = this.mode;
    if (mode === 'off') {
      return { mode, proofStatus: 'SKIPPED', reason: 'CONTROL_DISABLED' };
    }
    if (!attestation) {
      return { mode, proofStatus: 'MISSING', reason: 'DEVICE_PROOF_MISSING' };
    }

    try {
      const proof = await this.verifier(attestation.provider).verify(
        attestation,
        binding,
      );
      return {
        mode,
        proof,
        proofStatus: 'VERIFIED',
        reason: 'DEVICE_PROOF_VERIFIED',
        attestation,
      };
    } catch (error) {
      const reason = this.safeReason(error);
      this.logger.warn(
        `Preuve appareil refusee: provider=${attestation.provider} reason=${reason}`,
      );
      return { mode, proofStatus: 'INVALID', reason, attestation };
    }
  }

  /**
   * Reserves one device slot and writes the vendor-side counter before granting
   * the free quota. Any uncertain state fails closed for the quota, never for
   * account creation.
   */
  async allocate(
    userId: number,
    pays: string,
    prepared: PreparedDeviceCreditDecision,
  ): Promise<DeviceCreditAllocation> {
    if (prepared.mode === 'off') {
      return { eligible: true, reason: 'CONTROL_DISABLED' };
    }

    if (!prepared.proof) {
      const eligible = prepared.mode !== 'enforce';
      await this.record(userId, pays, prepared, {
        eligible,
        reason: prepared.reason,
      });
      return { eligible, reason: prepared.reason };
    }

    try {
      const reservation = await this.reserveAndWrite(prepared.proof);
      const withinLimit = reservation.countAfter <= this.maxEligibleAccounts;
      const eligible = prepared.mode === 'enforce' ? withinLimit : true;
      const reason = withinLimit
        ? 'DEVICE_SLOT_GRANTED'
        : 'DEVICE_FREE_QUOTA_LIMIT_REACHED';
      const result = { eligible, countAfter: reservation.countAfter, reason };
      await this.record(
        userId,
        pays,
        prepared,
        result,
        reservation.installationId,
      );
      return result;
    } catch (error) {
      const reason = this.safeReason(error);
      const eligible = prepared.mode !== 'enforce';
      this.logger.error(
        `Allocation quota appareil echouee: provider=${prepared.proof.provider} reason=${reason}`,
      );
      const result = { eligible, reason };
      await this.record(userId, pays, prepared, result);
      return result;
    }
  }

  async listForAdmin(minimum = 3) {
    const safeMinimum = Number.isFinite(minimum)
      ? Math.max(1, Math.floor(minimum))
      : 3;
    return this.resolver.getDataSource().query(
      `SELECT a.id,
              a.fournisseur,
              a.plateforme,
              a.inscriptions_comptabilisees,
              a.compteur_fournisseur,
              a.derniere_verification,
              COUNT(e.id)::int AS comptes,
              COUNT(e.id) FILTER (WHERE e.eligible = false)::int AS comptes_sans_quota
         FROM appareils_quota_gratuit a
         LEFT JOIN eligibilites_quota_gratuit e ON e.appareil_id = a.id
        WHERE a.inscriptions_comptabilisees >= $1
        GROUP BY a.id
        ORDER BY a.inscriptions_comptabilisees DESC, a.derniere_verification DESC`,
      [safeMinimum],
    );
  }

  async overrideForAdmin(
    userId: number,
    adminId: number,
    eligible: boolean,
    reason?: string,
  ) {
    const normalizedReason = (reason?.trim() || 'ADMIN_OVERRIDE').slice(0, 80);
    return this.resolver.getDataSource().transaction(async (manager) => {
      const [user] = await manager.query(
        `UPDATE utilisateurs
            SET quota_gratuit_eligible = $2
          WHERE id = $1
          RETURNING id, uuid, pays, quota_gratuit_eligible`,
        [userId, eligible],
      );
      if (!user) throw new NotFoundException('Utilisateur introuvable');

      await manager.query(
        `INSERT INTO eligibilites_quota_gratuit
           (utilisateur_id, pays, mode_controle, statut, eligible, motif,
            admin_modification_id, date_modification)
         VALUES ($1, $2, $3, 'DECISION_ADMIN', $4, $5, $6, now())
         ON CONFLICT (utilisateur_id) DO UPDATE
           SET statut = 'DECISION_ADMIN',
               eligible = EXCLUDED.eligible,
               motif = EXCLUDED.motif,
               admin_modification_id = EXCLUDED.admin_modification_id,
               date_modification = now()`,
        [userId, user.pays, this.mode, eligible, normalizedReason, adminId],
      );

      return {
        utilisateur_id: user.id,
        utilisateur_uuid: user.uuid,
        pays: user.pays,
        quota_gratuit_eligible: user.quota_gratuit_eligible,
        reason: normalizedReason,
      };
    });
  }

  private async reserveAndWrite(
    proof: VerifiedDeviceProof,
  ): Promise<{ installationId: string; countAfter: number }> {
    const installationHash = this.hashInstallation(proof.installationId);
    const lockKey = `${proof.provider}:${installationHash}`;

    return this.resolver.getDataSource().transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [lockKey],
      );

      let [row] = await manager.query(
        `SELECT id, inscriptions_comptabilisees, compteur_fournisseur
           FROM appareils_quota_gratuit
          WHERE fournisseur = $1 AND installation_hash = $2
          FOR UPDATE`,
        [proof.provider, installationHash],
      );

      if (!row) {
        [row] = await manager.query(
          `INSERT INTO appareils_quota_gratuit
             (fournisseur, plateforme, installation_hash, inscriptions_comptabilisees, compteur_fournisseur)
           VALUES ($1, $2, $3, 0, $4)
           RETURNING id, inscriptions_comptabilisees, compteur_fournisseur`,
          [proof.provider, proof.platform, installationHash, proof.vendorCount],
        );
      }

      const current = Math.max(
        Number(row.inscriptions_comptabilisees ?? 0),
        Number(row.compteur_fournisseur ?? 0),
        proof.vendorCount,
      );
      const countAfter = current + 1;

      if (countAfter <= this.maxEligibleAccounts) {
        await this.verifier(proof.provider).writeCount(proof, countAfter);
      }

      const vendorCountAfter =
        countAfter <= this.maxEligibleAccounts
          ? countAfter
          : Math.max(proof.vendorCount, this.maxEligibleAccounts);

      await manager.query(
        `UPDATE appareils_quota_gratuit
            SET inscriptions_comptabilisees = $2,
                compteur_fournisseur = GREATEST(compteur_fournisseur, $3),
                derniere_verification = now(),
                date_modification = now()
          WHERE id = $1`,
        [row.id, countAfter, vendorCountAfter],
      );

      return { installationId: row.id, countAfter };
    });
  }

  private async record(
    userId: number,
    pays: string,
    prepared: PreparedDeviceCreditDecision,
    allocation: DeviceCreditAllocation,
    installationId?: string,
  ): Promise<void> {
    try {
      const status =
        prepared.proofStatus === 'MISSING'
          ? 'SANS_PREUVE'
          : prepared.proofStatus === 'INVALID'
            ? 'ERREUR_PREUVE'
            : prepared.mode === 'monitor'
              ? 'OBSERVATION'
              : allocation.eligible
                ? 'ACCORDEE'
                : 'REFUSEE';
      await this.eligibilityRepository.insert({
        userId,
        pays,
        provider: prepared.proof?.provider ?? prepared.attestation?.provider,
        deviceId: installationId,
        mode: prepared.mode,
        status,
        eligible: allocation.eligible,
        countAfter: allocation.countAfter,
        reason: allocation.reason.slice(0, 80),
      } as any);
    } catch (error) {
      // The user decision is already fail-safe. Audit loss must not roll back signup.
      this.logger.error(
        `Journalisation eligibilite quota echouee: utilisateur=${userId}`,
      );
    }
  }

  private verifier(provider: DeviceAttestationProvider): DeviceProofVerifier {
    if (provider === DeviceAttestationProvider.ANDROID_PLAY_INTEGRITY)
      return this.android;
    if (provider === DeviceAttestationProvider.IOS_DEVICECHECK) return this.ios;
    throw new Error('DEVICE_PROVIDER_UNSUPPORTED');
  }

  private hashInstallation(installationId: string): string {
    const secret = this.config.get<string>('DEVICE_CREDIT_HMAC_SECRET')?.trim();
    if (!secret || secret.length < 32)
      throw new Error('DEVICE_CREDIT_HMAC_SECRET_INVALID');
    return createHmac('sha256', secret)
      .update(installationId.trim().toLowerCase())
      .digest('hex');
  }

  private safeReason(error: unknown): string {
    const value =
      error instanceof Error ? error.message : 'DEVICE_PROOF_FAILED';
    return /^[A-Z0-9_]+$/.test(value)
      ? value.slice(0, 80)
      : 'DEVICE_PROOF_FAILED';
  }
}
