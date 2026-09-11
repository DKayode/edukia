import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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
    };
  }
}
