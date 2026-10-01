import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { AppareilType } from './entities/refresh-token.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Une session par type d'appareil, appliquée tout de suite : un téléphone dont
 * la session a été remplacée ne garde plus 24 h d'accès.
 */
describe('Session unique par appareil', () => {
  const payload = (extra: Record<string, unknown> = {}) => ({
    sub: 7,
    email: 'jane@example.com',
    role: 'étudiant' as any,
    abonnement_actif: false,
    ...extra,
  });

  describe('JwtStrategy', () => {
    let auth: any, strategy: JwtStrategy;
    const req = { headers: { authorization: 'Bearer jeton' } };
    const modeInitial = process.env.SESSION_UNIQUE_MODE;

    beforeEach(() => {
      auth = {
        isTokenBlacklisted: jest.fn().mockResolvedValue(false),
        isSessionActive: jest.fn().mockResolvedValue(true),
      };
      strategy = new JwtStrategy(auth);
      delete process.env.SESSION_UNIQUE_MODE;
    });
    afterAll(() => {
      if (modeInitial === undefined) delete process.env.SESSION_UNIQUE_MODE;
      else process.env.SESSION_UNIQUE_MODE = modeInitial;
    });

    it('accepte un jeton dont la session existe', async () => {
      const user = await strategy.validate(req, payload({ sid: 42 }));
      expect(auth.isSessionActive).toHaveBeenCalledWith(7, 42);
      expect(user.sessionId).toBe(42);
    });

    it('refuse un jeton dont la session a été remplacée', async () => {
      auth.isSessionActive.mockResolvedValue(false);
      await expect(strategy.validate(req, payload({ sid: 42 }))).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SESSION_REMPLACEE' }),
      });
      await expect(strategy.validate(req, payload({ sid: 42 }))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('tolère un jeton émis avant le sid, jusqu’à son expiration', async () => {
      const user = await strategy.validate(req, payload());
      expect(auth.isSessionActive).not.toHaveBeenCalled();
      expect(user.sessionId).toBeNull();
    });

    it('en monitor, journalise sans refuser', async () => {
      process.env.SESSION_UNIQUE_MODE = 'monitor';
      auth.isSessionActive.mockResolvedValue(false);
      await expect(strategy.validate(req, payload({ sid: 42 }))).resolves.toBeDefined();
    });

    it('en off, ne vérifie rien', async () => {
      process.env.SESSION_UNIQUE_MODE = 'off';
      await strategy.validate(req, payload({ sid: 42 }));
      expect(auth.isSessionActive).not.toHaveBeenCalled();
    });
  });

  describe('AuthService', () => {
    let utilisateurs: any, jwt: any, repo: any, service: AuthService;

    beforeEach(async () => {
      utilisateurs = {
        findByIdentifier: jest.fn().mockResolvedValue({
          id: 7,
          email: 'jane@example.com',
          role: 'étudiant',
          mot_de_passe: await bcrypt.hash('secret', 4),
        }),
        inscription: jest.fn().mockResolvedValue({ id: 7, email: 'jane@example.com' }),
      };
      jwt = { sign: jest.fn().mockReturnValue('jeton') };
      repo = {
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn((x) => x),
        save: jest.fn((x) => Promise.resolve({ ...x, id: 99 })),
        insert: jest.fn().mockResolvedValue({}),
        exist: jest.fn().mockResolvedValue(true),
      };
      const resolver = { getRepository: () => repo };
      const entitlement = { hasActiveSubscription: jest.fn().mockResolvedValue(false) };
      service = new AuthService(utilisateurs, jwt, resolver as any, {} as any, entitlement as any);
    });

    it('signe le jeton d’accès avec l’id de la session ouverte', async () => {
      const r = await service.login({ email: 'jane@example.com', mot_de_passe: 'secret' } as any, AppareilType.MOBILE);
      expect(repo.delete).toHaveBeenCalledWith({ utilisateur_id: 7, appareil: AppareilType.MOBILE });
      expect(jwt.sign.mock.calls[0][0].sid).toBe(99);
      expect(r.refresh_token.startsWith('99:')).toBe(true);
    });

    it('la déconnexion ne ferme que la session du jeton', async () => {
      await service.revokeSession(7, 99);
      expect(repo.delete).toHaveBeenCalledWith({ id: 99, utilisateur_id: 7 });
    });

    it('/auth/register transmet le mot de passe en clair : inscription le hache une seule fois', async () => {
      await service.register('benin', { nom: 'D', prenom: 'J', email: 'jane@example.com', mot_de_passe: 'secret' } as any);
      expect(utilisateurs.inscription.mock.calls[0][1].mot_de_passe).toBe('secret');
    });
  });
});
