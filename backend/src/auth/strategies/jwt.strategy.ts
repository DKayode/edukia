import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthService } from '../auth.service';

/**
 * `enforce` (défaut) refuse un jeton dont la session a été remplacée,
 * `monitor` le journalise seulement, `off` ne vérifie rien.
 */
export type ModeSessionUnique = 'off' | 'monitor' | 'enforce';

export function modeSessionUnique(): ModeSessionUnique {
  const mode = (process.env.SESSION_UNIQUE_MODE ?? 'enforce').trim().toLowerCase();
  return mode === 'off' || mode === 'monitor' ? mode : 'enforce';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload) {
    // Auth is intentionally cross-country: a single account can switch
    // scope via the country switcher without re-authenticating, so we
    // don't compare the request's country against the token's any more.

    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const isBlacklisted = await this.authService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token blacklisté/révoqué');
      }
    }
    // Sans ce contrôle, un téléphone dont la session a été remplacée par une
    // connexion ailleurs gardait l'accès jusqu'à 24 h : de quoi partager un
    // abonnement en se reconnectant chacun son tour une fois par jour.
    const mode = modeSessionUnique();
    if (payload.sid !== undefined && mode !== 'off') {
      const active = await this.authService.isSessionActive(payload.sub, payload.sid);
      if (!active) {
        if (mode === 'enforce') {
          throw new UnauthorizedException({
            statusCode: 401,
            code: 'SESSION_REMPLACEE',
            message: 'Votre compte a été connecté sur un autre appareil. Veuillez vous reconnecter.',
          });
        }
        this.logger.warn(`Session ${payload.sid} remplacée, jeton toléré (monitor) pour utilisateur ${payload.sub}`);
      }
    }

    // `abonnement_actif` n'est VOLONTAIREMENT pas relayé dans `req.user`.
    // Le claim est une photographie vieille de 24 h au plus ; il est posé pour
    // les services tiers qui n'ont pas accès à la base. Côté Edukia, les gardes
    // interrogent `abonnements` à chaque appel, et l'exposer ici ne servirait
    // qu'à inviter quelqu'un à s'en contenter — un abonnement résilié resterait
    // alors valable jusqu'à l'expiration du jeton.
    return {
      utilisateurId: payload.sub,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions ?? null,
      sessionId: payload.sid ?? null,
    };
  }
}
