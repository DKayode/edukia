import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import {
  DeviceAttestationDto,
  DeviceAttestationProvider,
} from './dto/device-attestation.dto';
import {
  DeviceProofVerifier,
  RegistrationBinding,
  VerifiedDeviceProof,
} from './device-credit.types';

@Injectable()
export class AppleDeviceCheckProvider implements DeviceProofVerifier {
  private cachedToken?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  async verify(
    attestation: DeviceAttestationDto,
    _binding: RegistrationBinding,
  ): Promise<VerifiedDeviceProof> {
    const response = await this.appleRequest(
      '/v1/query_two_bits',
      attestation.token,
    );
    return {
      provider: DeviceAttestationProvider.IOS_DEVICECHECK,
      platform: 'ios',
      installationId: attestation.installation_id,
      token: attestation.token,
      vendorCount: this.decodeCount(response.bit0, response.bit1),
    };
  }

  async writeCount(proof: VerifiedDeviceProof, count: number): Promise<void> {
    await this.appleRequest(
      '/v1/update_two_bits',
      proof.token,
      this.encodeCount(count),
    );
  }

  private async appleRequest(
    path: string,
    deviceToken: string,
    bits: Record<string, boolean> = {},
  ): Promise<any> {
    const timeoutMs = Number(
      this.config.get('DEVICE_CREDIT_PROVIDER_TIMEOUT_MS') ?? 5000,
    );
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.authorizationToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_token: deviceToken,
        transaction_id: randomUUID(),
        timestamp: Date.now(),
        ...bits,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`APPLE_DEVICECHECK_${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  private authorizationToken(): string {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now())
      return this.cachedToken.value;

    const teamId = this.config.get<string>('APPLE_DEVICECHECK_TEAM_ID')?.trim();
    const keyId = this.config.get<string>('APPLE_DEVICECHECK_KEY_ID')?.trim();
    const rawKey = this.config
      .get<string>('APPLE_DEVICECHECK_PRIVATE_KEY')
      ?.trim();
    const encodedKey = this.config
      .get<string>('APPLE_DEVICECHECK_PRIVATE_KEY_BASE64')
      ?.trim();
    const privateKey = encodedKey
      ? Buffer.from(encodedKey, 'base64').toString('utf8')
      : rawKey?.replace(/\\n/g, '\n');
    if (!teamId || !keyId || !privateKey)
      throw new Error('APPLE_DEVICECHECK_NOT_CONFIGURED');

    const issuedAt = Math.floor(Date.now() / 1000);
    const value = jwt.sign({ iss: teamId, iat: issuedAt }, privateKey, {
      algorithm: 'ES256',
      keyid: keyId,
      noTimestamp: true,
    });
    this.cachedToken = { value, expiresAt: Date.now() + 20 * 60 * 1000 };
    return value;
  }

  private baseUrl(): string {
    const environment = this.config
      .get<string>('APPLE_DEVICECHECK_ENVIRONMENT')
      ?.toLowerCase();
    return environment === 'development'
      ? 'https://api.development.devicecheck.apple.com'
      : 'https://api.devicecheck.apple.com';
  }

  private decodeCount(first: boolean, second: boolean): number {
    return (first ? 1 : 0) + (second ? 2 : 0);
  }

  private encodeCount(count: number) {
    const safe = Math.max(0, Math.min(3, count));
    return {
      bit0: (safe & 1) === 1,
      bit1: (safe & 2) === 2,
    };
  }
}
