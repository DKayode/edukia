import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UtilisateursService } from './utilisateurs.service';
import { RoleType, SexeType, Utilisateur } from './entities/utilisateur.entity';

describe('UtilisateursService device credit eligibility', () => {
  let repository: any;
  let deviceCredits: any;
  let service: UtilisateursService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => ({
        id: 41,
        profil_photo_path: '',
        ...value,
      })),
      update: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
    };
    deviceCredits = {
      prepare: jest.fn().mockResolvedValue({
        mode: 'enforce',
        proofStatus: 'VERIFIED',
        reason: 'DEVICE_PROOF_VERIFIED',
      }),
      allocate: jest.fn().mockResolvedValue({
        eligible: false,
        countAfter: 4,
        reason: 'DEVICE_FREE_QUOTA_LIMIT_REACHED',
      }),
    };
    service = new UtilisateursService(
      {
        getRepository: (entity: unknown) =>
          entity === Utilisateur ? repository : {},
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      deviceCredits,
    );
  });

  const dto = () => ({
    nom: 'Doe',
    prenom: 'Jane',
    email: 'jane@example.com',
    mot_de_passe: 'secret123',
    role: RoleType.ETUDIANT,
    sexe: SexeType.F,
    device_attestation: {
      provider: 'ANDROID_PLAY_INTEGRITY' as any,
      installation_id: 'a52ed8ef-b84c-4262-95a8-0da2f105c78f',
      token: 'a-sensitive-integrity-token',
    },
  });

  it('stores the decision without storing the sensitive token', async () => {
    const input = dto();
    const result = await service.inscription('benin', input);

    expect(deviceCredits.prepare).toHaveBeenCalledWith(
      input.device_attestation,
      { email: input.email, pays: 'benin' },
    );
    expect(deviceCredits.allocate).toHaveBeenCalledWith(
      41,
      'benin',
      expect.any(Object),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ device_attestation: expect.anything() }),
    );
    expect(repository.create.mock.calls[0][0]).toMatchObject({
      quota_gratuit_eligible: false,
    });
    expect(repository.update).toHaveBeenCalledWith(41, {
      quota_gratuit_eligible: false,
    });
    expect(result.quota_gratuit_eligible).toBe(false);
    expect((result as any).mot_de_passe).toBeUndefined();
  });

  it('hashes the password exactly once', async () => {
    await service.inscription('benin', dto());
    const created = repository.create.mock.calls[0][0];

    expect(created.mot_de_passe).not.toBe('secret123');
    await expect(
      bcrypt.compare('secret123', created.mot_de_passe),
    ).resolves.toBe(true);
  });

  it('rejects a public self-assigned admin role', async () => {
    await expect(
      service.inscription('benin', { ...dto(), role: RoleType.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('allows a trusted admin-created account without device proof', async () => {
    const input = {
      ...dto(),
      role: RoleType.ADMIN,
      device_attestation: undefined,
    };
    const result = await service.inscription('benin', input, {
      trustedBackOffice: true,
    });

    expect(deviceCredits.prepare).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(41, {
      quota_gratuit_eligible: true,
    });
    expect(result.quota_gratuit_eligible).toBe(true);
  });

  it('keeps signup successful and fail-closed when the final flag update fails', async () => {
    deviceCredits.allocate.mockResolvedValueOnce({
      eligible: true,
      countAfter: 1,
      reason: 'DEVICE_SLOT_GRANTED',
    });
    repository.update.mockRejectedValueOnce(
      new Error('temporary database error'),
    );

    await expect(service.inscription('benin', dto())).resolves.toMatchObject({
      id: 41,
      quota_gratuit_eligible: false,
    });
  });
});
