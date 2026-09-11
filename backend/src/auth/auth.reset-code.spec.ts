import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Cycle de réinitialisation de mot de passe (edukia#243).
 *
 * On instancie le service avec des doublures minimales plutôt qu'un module Nest
 * complet : la logique testée ici est celle du cycle (cadence, plafonds,
 * expiration), pas le câblage des dépendances.
 */
describe('AuthService — code de réinitialisation', () => {
  const EMAIL = 'user@example.com';

  let utilisateurs: any;
  let mail: any;
  let refreshTokenRepository: any;
  let service: AuthService;
  let user: any;

  beforeEach(() => {
    user = {
      id: 1,
      email: EMAIL,
      digit_code: null,
      date_expiration_code: null,
      code_dernier_envoi: null,
      code_envois: 0,
      code_tentatives: 0,
    };

    utilisateurs = {
      findByEmail: jest.fn().mockImplementation(async () => user),
      setResetCode: jest.fn().mockImplementation(async (_e, code, expiration, envois) => {
        Object.assign(user, {
          digit_code: code,
          date_expiration_code: expiration,
          code_dernier_envoi: new Date(),
          code_envois: envois,
          code_tentatives: 0,
        });
      }),
      clearResetCode: jest.fn().mockImplementation(async () => {
        Object.assign(user, {
          digit_code: null,
          date_expiration_code: null,
          code_envois: 0,
          code_tentatives: 0,
        });
      }),
      incrementResetAttempts: jest.fn().mockImplementation(async () => ++user.code_tentatives),
      updatePassword: jest.fn().mockImplementation(async () => {
        Object.assign(user, {
          digit_code: null,
          date_expiration_code: null,
          code_envois: 0,
          code_tentatives: 0,
        });
      }),
    };

    mail = { sendResetCode: jest.fn().mockResolvedValue(undefined) };
    refreshTokenRepository = { delete: jest.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      utilisateurs,
      {} as any,
      { getRepository: () => refreshTokenRepository } as any,
      mail,
      // Le service de droits ne sert qu'à poser le claim d'abonnement du jeton,
      // hors sujet pour la réinitialisation de mot de passe.
      { hasActiveSubscription: jest.fn().mockResolvedValue(false) } as any,
    );
  });

  /** Recule le dernier envoi pour franchir la cadence sans horloge simulée. */
  const franchirCadence = () => {
    user.code_dernier_envoi = new Date(
      Date.now() - (AuthService.RESET_CODE_COOLDOWN_SECONDS + 1) * 1000,
    );
  };

  const resetDto = (code: string) => ({
    email: EMAIL,
    code,
    nouveau_mot_de_passe: 'NouveauMotDePasse123!',
  });

  describe('envoi et renvoi', () => {
    it('génère un code à 6 chiffres et l’envoie', async () => {
      await service.sendResetCode(EMAIL);

      expect(user.digit_code).toMatch(/^\d{6}$/);
      expect(user.code_envois).toBe(1);
      expect(mail.sendResetCode).toHaveBeenCalledWith(EMAIL, user.digit_code, false);
    });

    it('produit un nouveau code au renvoi et signale qu’il s’agit d’un renvoi', async () => {
      await service.sendResetCode(EMAIL);
      const premier = user.digit_code;

      franchirCadence();
      await service.sendResetCode(EMAIL);

      expect(user.digit_code).not.toBe(premier);
      expect(user.code_envois).toBe(2);
      expect(mail.sendResetCode).toHaveBeenLastCalledWith(EMAIL, user.digit_code, true);
    });

    it('absorbe un renvoi demandé avant la fin de la cadence', async () => {
      await service.sendResetCode(EMAIL);
      const premier = user.digit_code;

      await service.sendResetCode(EMAIL);

      expect(user.digit_code).toBe(premier);
      expect(user.code_envois).toBe(1);
      expect(mail.sendResetCode).toHaveBeenCalledTimes(1);
    });

    it('invalide le code une fois le plafond d’envois atteint', async () => {
      for (let i = 0; i <= AuthService.RESET_CODE_MAX_ENVOIS; i++) {
        franchirCadence();
        await service.sendResetCode(EMAIL);
      }

      expect(user.digit_code).toBeNull();
      expect(utilisateurs.clearResetCode).toHaveBeenCalled();
    });

    it('applique la cadence même après invalidation du code', async () => {
      await service.sendResetCode(EMAIL);
      await utilisateurs.clearResetCode();

      // Le cycle est clos mais le dernier envoi est récent : rien ne doit partir.
      await service.sendResetCode(EMAIL);

      expect(user.digit_code).toBeNull();
      expect(mail.sendResetCode).toHaveBeenCalledTimes(1);
    });

    it('reste silencieux sur un email inconnu', async () => {
      utilisateurs.findByEmail.mockResolvedValueOnce(null);

      await expect(service.sendResetCode('inconnu@example.com')).resolves.toBeUndefined();
      expect(mail.sendResetCode).not.toHaveBeenCalled();
    });

    it('n’échoue pas quand l’envoi SMTP échoue', async () => {
      mail.sendResetCode.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(service.sendResetCode(EMAIL)).resolves.toBeUndefined();
      expect(user.digit_code).toMatch(/^\d{6}$/);
    });
  });

  describe('vérification du code', () => {
    it('réinitialise le mot de passe et révoque les sessions', async () => {
      await service.sendResetCode(EMAIL);

      await service.resetPassword(resetDto(user.digit_code));

      expect(utilisateurs.updatePassword).toHaveBeenCalledWith(1, expect.any(String));
      expect(refreshTokenRepository.delete).toHaveBeenCalledWith({ utilisateur_id: 1 });
    });

    it('refuse un code erroné et compte la tentative', async () => {
      await service.sendResetCode(EMAIL);

      await expect(service.resetPassword(resetDto('000000'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(user.code_tentatives).toBe(1);
    });

    it('invalide le code au plafond de tentatives, y compris pour le bon code', async () => {
      await service.sendResetCode(EMAIL);
      const bonCode = user.digit_code;

      for (let i = 0; i < AuthService.RESET_CODE_MAX_TENTATIVES; i++) {
        await expect(service.resetPassword(resetDto('000000'))).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }

      expect(user.digit_code).toBeNull();
      await expect(service.resetPassword(resetDto(bonCode))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(utilisateurs.updatePassword).not.toHaveBeenCalled();
    });

    it.each(['12345', '1234567', 'abcdef'])(
      'refuse un code de forme invalide (%s) sans lever d’exception technique',
      async (mauvais) => {
        await service.sendResetCode(EMAIL);

        // `timingSafeEqual` jette sur des longueurs différentes : le garde-fou
        // de longueur doit intercepter avant, sinon on renvoie un 500 au lieu
        // d'un 401 — et on révèle la longueur attendue par le type d'erreur.
        await expect(service.resetPassword(resetDto(mauvais))).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      },
    );

    it('traite une expiration NULL comme expirée', async () => {
      await service.sendResetCode(EMAIL);
      const code = user.digit_code;
      user.date_expiration_code = null;

      await expect(service.resetPassword(resetDto(code))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuse un code expiré', async () => {
      await service.sendResetCode(EMAIL);
      const code = user.digit_code;
      user.date_expiration_code = new Date(Date.now() - 1000);

      await expect(service.resetPassword(resetDto(code))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('donne le même refus quel que soit le motif', async () => {
      utilisateurs.findByEmail.mockResolvedValueOnce(null);
      const inconnu = await service.resetPassword(resetDto('123456')).catch((e) => e.message);

      await service.sendResetCode(EMAIL);
      const mauvais = await service.resetPassword(resetDto('000000')).catch((e) => e.message);

      expect(inconnu).toBe(mauvais);
    });
  });
});
