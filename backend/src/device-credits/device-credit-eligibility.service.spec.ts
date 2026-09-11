import { androidRegistrationRequestHash } from './android-play-integrity.provider';
import { DeviceCreditEligibilityService } from './device-credit-eligibility.service';
import { DeviceAttestationProvider } from './dto/device-attestation.dto';

describe('DeviceCreditEligibilityService', () => {
  const binding = { email: 'User@Example.com', pays: 'Benin' };
  const attestation = {
    provider: DeviceAttestationProvider.ANDROID_PLAY_INTEGRITY,
    installation_id: 'a52ed8ef-b84c-4262-95a8-0da2f105c78f',
    token: 'integrity-token-long-enough',
  };

  let values: Record<string, unknown>;
  let android: any;
  let ios: any;
  let repository: any;
  let service: DeviceCreditEligibilityService;

  beforeEach(() => {
    values = {
      DEVICE_CREDIT_CONTROL_MODE: 'enforce',
      DEVICE_CREDIT_MAX_ACCOUNTS: 3,
      DEVICE_CREDIT_HMAC_SECRET:
        'a-secure-test-secret-with-at-least-32-characters',
    };
    android = {
      verify: jest.fn().mockResolvedValue({
        provider: DeviceAttestationProvider.ANDROID_PLAY_INTEGRITY,
        platform: 'android',
        installationId: attestation.installation_id,
        token: attestation.token,
        vendorCount: 0,
      }),
      writeCount: jest.fn().mockResolvedValue(undefined),
    };
    ios = { verify: jest.fn(), writeCount: jest.fn() };
    repository = { insert: jest.fn().mockResolvedValue(undefined) };
    service = new DeviceCreditEligibilityService(
      { get: (key: string) => values[key] } as any,
      {} as any,
      android,
      ios,
      repository,
    );
  });

  it('binds the Android proof to normalized registration data', () => {
    expect(
      androidRegistrationRequestHash(binding, attestation.installation_id),
    ).toBe(
      androidRegistrationRequestHash(
        { email: 'user@example.com', pays: 'benin' },
        attestation.installation_id,
      ),
    );
    expect(
      androidRegistrationRequestHash(binding, attestation.installation_id),
    ).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('keeps all new accounts eligible while control is off', async () => {
    values.DEVICE_CREDIT_CONTROL_MODE = 'off';
    const prepared = await service.prepare(undefined, binding);
    const result = await service.allocate(1, 'benin', prepared);

    expect(result).toEqual({ eligible: true, reason: 'CONTROL_DISABLED' });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('denies free quota without a device proof in enforce mode', async () => {
    const prepared = await service.prepare(undefined, binding);
    const result = await service.allocate(1, 'benin', prepared);

    expect(result).toEqual({ eligible: false, reason: 'DEVICE_PROOF_MISSING' });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        eligible: false,
        status: 'SANS_PREUVE',
      }),
    );
  });

  it('allows the first three accounts and denies the fourth', async () => {
    const prepared = await service.prepare(attestation, binding);
    const reserve = jest.spyOn(service as any, 'reserveAndWrite');
    reserve
      .mockResolvedValueOnce({ installationId: 'device-1', countAfter: 1 })
      .mockResolvedValueOnce({ installationId: 'device-1', countAfter: 2 })
      .mockResolvedValueOnce({ installationId: 'device-1', countAfter: 3 })
      .mockResolvedValueOnce({ installationId: 'device-1', countAfter: 4 });

    const results = [];
    for (let userId = 1; userId <= 4; userId++) {
      results.push(await service.allocate(userId, 'benin', prepared));
    }

    expect(results.map((result) => result.eligible)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(results[3]).toMatchObject({
      countAfter: 4,
      reason: 'DEVICE_FREE_QUOTA_LIMIT_REACHED',
    });
  });

  it('serializes and persists a device slot before granting it', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'device-1',
            inscriptions_comptabilisees: 0,
            compteur_fournisseur: 2,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const resolver = {
      getDataSource: () => ({
        transaction: (callback: (value: any) => unknown) => callback(manager),
      }),
    };
    service = new DeviceCreditEligibilityService(
      { get: (key: string) => values[key] } as any,
      resolver as any,
      android,
      ios,
      repository,
    );

    await expect(
      (service as any).reserveAndWrite(await android.verify()),
    ).resolves.toEqual({ installationId: 'device-1', countAfter: 3 });
    expect(manager.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(android.writeCount).toHaveBeenCalledWith(expect.any(Object), 3);
    expect(manager.query.mock.calls[3][1]).toEqual(['device-1', 3, 3]);
  });

  it('does not overwrite the saturated vendor counter for later accounts', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'device-1',
            inscriptions_comptabilisees: 3,
            compteur_fournisseur: 3,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const resolver = {
      getDataSource: () => ({
        transaction: (callback: (value: any) => unknown) => callback(manager),
      }),
    };
    service = new DeviceCreditEligibilityService(
      { get: (key: string) => values[key] } as any,
      resolver as any,
      android,
      ios,
      repository,
    );

    await expect(
      (service as any).reserveAndWrite(await android.verify()),
    ).resolves.toEqual({ installationId: 'device-1', countAfter: 4 });
    expect(android.writeCount).not.toHaveBeenCalled();
    expect(manager.query.mock.calls[2][1]).toEqual(['device-1', 4, 3]);
  });

  it('records a traced admin exception without resetting the device counter', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 41,
            uuid: 'user-uuid',
            pays: 'benin',
            quota_gratuit_eligible: true,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const resolver = {
      getDataSource: () => ({
        transaction: (callback: (value: any) => unknown) => callback(manager),
      }),
    };
    service = new DeviceCreditEligibilityService(
      { get: (key: string) => values[key] } as any,
      resolver as any,
      android,
      ios,
      repository,
    );

    await expect(
      service.overrideForAdmin(41, 7, true, ' telephone familial verifie '),
    ).resolves.toEqual({
      utilisateur_id: 41,
      utilisateur_uuid: 'user-uuid',
      pays: 'benin',
      quota_gratuit_eligible: true,
      reason: 'telephone familial verifie',
    });
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(manager.query.mock.calls[1][1]).toEqual([
      41,
      'benin',
      'enforce',
      true,
      'telephone familial verifie',
      7,
    ]);
  });

  it('observes an exceeded limit without removing quota in monitor mode', async () => {
    values.DEVICE_CREDIT_CONTROL_MODE = 'monitor';
    const prepared = await service.prepare(attestation, binding);
    jest.spyOn(service as any, 'reserveAndWrite').mockResolvedValue({
      installationId: 'device-1',
      countAfter: 4,
    });

    await expect(service.allocate(4, 'benin', prepared)).resolves.toMatchObject(
      {
        eligible: true,
        reason: 'DEVICE_FREE_QUOTA_LIMIT_REACHED',
      },
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OBSERVATION' }),
    );
  });

  it('fails closed for quota when provider verification fails', async () => {
    android.verify.mockRejectedValueOnce(
      new Error('PLAY_DEVICE_INTEGRITY_FAILED'),
    );
    const prepared = await service.prepare(attestation, binding);
    const result = await service.allocate(1, 'benin', prepared);

    expect(result).toEqual({
      eligible: false,
      reason: 'PLAY_DEVICE_INTEGRITY_FAILED',
    });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ERREUR_PREUVE' }),
    );
  });
});
