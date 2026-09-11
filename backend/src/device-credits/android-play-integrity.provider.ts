import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import {
  DeviceAttestationDto,
  DeviceAttestationProvider,
} from './dto/device-attestation.dto';
import {
  DeviceProofVerifier,
  RegistrationBinding,
  VerifiedDeviceProof,
} from './device-credit.types';

const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';

/** Contract shared with the Android client when requesting a standard integrity token. */
export function androidRegistrationRequestHash(
  binding: RegistrationBinding,
  installationId: string,
): string {
  const value = [
    'edukia-register-v1',
    binding.email.trim().toLowerCase(),
    binding.pays.trim().toLowerCase(),
    installationId.trim().toLowerCase(),
  ].join('\n');
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

@Injectable()
export class AndroidPlayIntegrityProvider implements DeviceProofVerifier {
  private readonly auth: GoogleAuth;

  constructor(private readonly config: ConfigService) {
    const rawCredentials = this.config.get<string>(
      'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON',
    );
    let credentials: Record<string, unknown> | undefined;
    if (rawCredentials) {
      try {
        credentials = JSON.parse(rawCredentials);
      } catch {
        throw new Error(
          'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON doit contenir un JSON valide',
        );
      }
    }
    this.auth = new GoogleAuth({ credentials, scopes: [PLAY_INTEGRITY_SCOPE] });
  }

  async verify(
    attestation: DeviceAttestationDto,
    binding: RegistrationBinding,
  ): Promise<VerifiedDeviceProof> {
    const packageName = this.packageName();
    const payload = await this.decodeToken(attestation.token, packageName);
    const requestDetails = payload?.requestDetails ?? {};

    if (requestDetails.requestPackageName !== packageName) {
      throw new Error('PLAY_PACKAGE_MISMATCH');
    }

    const expectedHash = androidRegistrationRequestHash(
      binding,
      attestation.installation_id,
    );
    if (requestDetails.requestHash !== expectedHash) {
      throw new Error('PLAY_REQUEST_HASH_MISMATCH');
    }

    const timestamp = Number(requestDetails.timestampMillis);
    const maxAgeMs = Number(
      this.config.get('DEVICE_CREDIT_ATTESTATION_MAX_AGE_MS') ?? 120000,
    );
    if (
      !Number.isFinite(timestamp) ||
      timestamp > Date.now() + 30000 ||
      Date.now() - timestamp > maxAgeMs
    ) {
      throw new Error('PLAY_TOKEN_EXPIRED');
    }

    if (payload?.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
      throw new Error('PLAY_APP_NOT_RECOGNIZED');
    }
    if (payload?.accountDetails?.appLicensingVerdict !== 'LICENSED') {
      throw new Error('PLAY_APP_NOT_LICENSED');
    }

    const deviceVerdicts: string[] =
      payload?.deviceIntegrity?.deviceRecognitionVerdict ?? [];
    if (!deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY')) {
      throw new Error('PLAY_DEVICE_INTEGRITY_FAILED');
    }

    const recall = payload?.deviceIntegrity?.deviceRecall;
    const recallValues = recall?.values;
    if (
      !recallValues ||
      (!Object.prototype.hasOwnProperty.call(recallValues, 'bitFirst') &&
        !Object.prototype.hasOwnProperty.call(recallValues, 'bitSecond'))
    ) {
      throw new Error('PLAY_DEVICE_RECALL_UNAVAILABLE');
    }

    return {
      provider: DeviceAttestationProvider.ANDROID_PLAY_INTEGRITY,
      platform: 'android',
      installationId: attestation.installation_id,
      token: attestation.token,
      vendorCount: this.decodeCount(
        recallValues.bitFirst,
        recallValues.bitSecond,
      ),
    };
  }

  async writeCount(proof: VerifiedDeviceProof, count: number): Promise<void> {
    const packageName = this.packageName();
    const response = await this.authorizedFetch(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}/deviceRecall:write`,
      {
        integrityToken: proof.token,
        newValues: this.encodeCount(count),
      },
    );
    if (!response.ok) {
      throw new Error(`PLAY_DEVICE_RECALL_WRITE_${response.status}`);
    }
  }

  private packageName(): string {
    const value = this.config
      .get<string>('PLAY_INTEGRITY_PACKAGE_NAME')
      ?.trim();
    if (!value) throw new Error('PLAY_INTEGRITY_NOT_CONFIGURED');
    return value;
  }

  private async decodeToken(token: string, packageName: string): Promise<any> {
    const response = await this.authorizedFetch(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
      { integrity_token: token },
    );
    if (!response.ok) {
      throw new Error(`PLAY_INTEGRITY_DECODE_${response.status}`);
    }
    const json = await response.json();
    return json?.tokenPayloadExternal;
  }

  private async authorizedFetch(
    url: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const client = await this.auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) throw new Error('PLAY_INTEGRITY_AUTH_FAILED');
    const timeoutMs = Number(
      this.config.get('DEVICE_CREDIT_PROVIDER_TIMEOUT_MS') ?? 5000,
    );
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private decodeCount(first: boolean, second: boolean): number {
    return (first ? 1 : 0) + (second ? 2 : 0);
  }

  private encodeCount(count: number) {
    const safe = Math.max(0, Math.min(3, count));
    return {
      bitFirst: (safe & 1) === 1,
      bitSecond: (safe & 2) === 2,
    };
  }
}
