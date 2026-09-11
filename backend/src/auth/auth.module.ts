import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RoleGuard } from './guards/role.guard';
import { UtilisateursModule } from '../utilisateurs/utilisateurs.module';
import { RefreshToken } from './entities/refresh-token.entity';
import { BlacklistedToken } from './entities/blacklisted-token.entity';
import { LoginEvent } from './entities/login-event.entity';
import { MailModule } from '../mail/mail.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AbonnementsModule } from '../abonnements/abonnements.module';

@Module({
  imports: [
    UtilisateursModule,
    // Pour poser `abonnement_actif` dans le jeton — voir AuthService.payloadJeton.
    forwardRef(() => AbonnementsModule),
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([RefreshToken, BlacklistedToken, LoginEvent]),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule { }