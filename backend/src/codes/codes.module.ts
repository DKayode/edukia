import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AbonnementsModule } from '../abonnements/abonnements.module';
import { CodeValidationService } from './code-validation.service';
import { CodeValidationRateLimitGuard } from './code-validation-rate-limit.guard';
import { CodesAdminController } from './codes-admin.controller';
import { CodesController } from './codes.controller';
import { CodesService } from './codes.service';
import { CampagneCode } from './entities/campagne-code.entity';
import { CodeUtilisation } from './entities/code-utilisation.entity';
import { Code } from './entities/code.entity';
import { CodeEffet } from './entities/code-effet.entity';

const entierPositif = (valeur: string | undefined, valeurParDefaut: number) => {
  const resultat = Number(valeur);
  return Number.isInteger(resultat) && resultat > 0
    ? resultat
    : valeurParDefaut;
};

/**
 * Registre unifié des codes : parrainage, ambassadeur, réduction.
 *
 * `CodeValidationService` est la seule surface consommée par le module
 * abonnements — il l'utilise pour valider et consommer un code à la
 * souscription.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Code, CodeEffet, CampagneCode, CodeUtilisation]),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'codes-burst',
            ttl: 60_000,
            limit: entierPositif(
              config.get<string>('CODE_VALIDATION_RATE_LIMIT_BURST'),
              10,
            ),
          },
          {
            name: 'codes-hourly',
            ttl: 3_600_000,
            limit: entierPositif(
              config.get<string>('CODE_VALIDATION_RATE_LIMIT_HOURLY'),
              100,
            ),
          },
        ],
        errorMessage:
          'Trop de tentatives de validation de code. Réessayez plus tard.',
      }),
    }),
    // Lien à sens unique : AbonnementsModule fournit PlansService pour l'aperçu
    // de remise. L'inverse passe par ModuleRef dans AbonnementsService, ce qui
    // évite de fermer un cycle de modules.
    AbonnementsModule,
  ],
  controllers: [CodesController, CodesAdminController],
  providers: [
    CodesService,
    CodeValidationService,
    CodeValidationRateLimitGuard,
  ],
  exports: [CodesService, CodeValidationService],
})
export class CodesModule {}
