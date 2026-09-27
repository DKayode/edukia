import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { UtilisateursService } from './utilisateurs.service';
import { UtilisateursController } from './utilisateurs.controller';
import { ProfilCompletionService } from './profil-completion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { OwnerOrAdminGuard } from '../auth/guards/owner-or-admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';

describe('Vérification email', () => {
  let user: any;
  let repo: any;
  let mail: { sendVerifyEmailCode: jest.Mock };
  let service: UtilisateursService;

  const demain = () => new Date(Date.now() + 24 * 3600 * 1000);

  beforeEach(() => {
    user = { id: 1, email: 'a@b.co', verifier: false, digit_code: null, date_expiration_code: null };
    repo = {
      findOne: jest.fn(async () => user),
      save: jest.fn(async (u) => Object.assign(user, u)),
    };
    mail = { sendVerifyEmailCode: jest.fn().mockResolvedValue(undefined) };
    const resolver: any = { getRepository: () => repo };
    service = new UtilisateursService(resolver, {} as any, {} as any, {} as any, mail as any);
  });

  it('renvoie le même code tant qu\'il est valide : le code du premier email reste bon', async () => {
    await service.verifyEmail('a@b.co');
    await service.verifyEmail('a@b.co');

    const [premier, second] = mail.sendVerifyEmailCode.mock.calls.map(([, code]) => code);
    expect(premier).toMatch(/^\d{6}$/);
    expect(second).toBe(premier);
    await expect(service.validateEmail({ email: 'a@b.co', code: premier })).resolves.toMatchObject({ verifier: true });
  });

  it('régénère un code expiré', async () => {
    Object.assign(user, { digit_code: '111111', date_expiration_code: new Date(Date.now() - 1000) });
    await service.verifyEmail('a@b.co');
    expect(mail.sendVerifyEmailCode.mock.calls[0][1]).not.toBe('111111');
  });

  it('accepte un code collé avec des espaces', async () => {
    Object.assign(user, { digit_code: '482913', date_expiration_code: demain() });
    await expect(service.validateEmail({ email: 'a@b.co', code: ' 482 913\n' })).resolves.toMatchObject({ verifier: true });
    expect(user.digit_code).toBeNull();
  });

  it('un code faux ne dé-vérifie pas un compte déjà vérifié', async () => {
    Object.assign(user, { verifier: true });
    await expect(service.validateEmail({ email: 'a@b.co', code: '000000' })).rejects.toThrow(BadRequestException);
    expect(user.verifier).toBe(true);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuse un code expiré', async () => {
    Object.assign(user, { digit_code: '482913', date_expiration_code: new Date(Date.now() - 1000) });
    await expect(service.validateEmail({ email: 'a@b.co', code: '482913' })).rejects.toThrow('Le code de validation a expiré');
  });
});

describe('Vérification email (HTTP)', () => {
  let app: INestApplication;
  const service = {
    verifyEmail: jest.fn().mockResolvedValue({ message: 'Code de vérification envoyé avec succès' }),
    validateEmail: jest.fn().mockResolvedValue({ message: 'Email vérifié avec succès', verifier: true }),
  };

  beforeAll(async () => {
    const libre = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [UtilisateursController],
      providers: [
        { provide: UtilisateursService, useValue: service },
        { provide: ProfilCompletionService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(libre)
      .overrideGuard(RoleGuard).useValue(libre)
      .overrideGuard(OwnerOrAdminGuard).useValue(libre)
      .overrideGuard(PermissionGuard).useValue(libre)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(() => app.close());

  // L'app mobile teste `statusCode == 200` : un 201 faisait passer un succès pour un échec.
  it('verify-email répond 200', async () => {
    await request(app.getHttpServer()).post('/utilisateurs/verify-email').send({ email: 'a@b.co' }).expect(200);
  });

  it('validate-email répond 200 avec verifier: true', async () => {
    const res = await request(app.getHttpServer())
      .post('/utilisateurs/validate-email')
      .send({ email: 'a@b.co', code: '482913' })
      .expect(200);
    expect(res.body).toEqual({ message: 'Email vérifié avec succès', verifier: true });
  });
});
