import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AbonnementsModule } from '../abonnements/abonnements.module';
import { Abonnement } from '../abonnements/entities/abonnement.entity';
import { Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { ConfigurationPaiement } from './entities/configuration-paiement.entity';
import { PaiementWebhook } from './entities/paiement-webhook.entity';
import { Paiement } from './entities/paiement.entity';
import { PaiementsAdminController } from './paiements-admin.controller';
import { PaiementsController } from './paiements.controller';
import { PaiementCredentialsService } from './paiement-credentials.service';
import { PaiementVerificationRateLimitGuard } from './paiement-verification-rate-limit.guard';
import { PaiementsService } from './paiements.service';
import { FedaPayProvider } from './providers/fedapay.provider';
import { KkiaPayProvider } from './providers/kkiapay.provider';
import { StripeProvider } from './providers/stripe.provider';
import { RevenueCatProvider } from './providers/revenuecat.provider';
import { PaiementProviderRegistry } from './providers/paiement-provider.registry';
import { PAIEMENT_PROVIDERS } from './shared/paiement.tokens';
import { WebhooksController } from './webhooks.controller';
import { PlanAbonnement } from '../abonnements/entities/plan-abonnement.entity';
import { CodesModule } from '../codes/codes.module';

/** Un réglage absent ou absurde retombe sur la valeur par défaut, jamais sur 0. */
function entierPositif(valeur: string | undefined, defaut: number): number {
  const n = Number(valeur);
  return Number.isInteger(n) && n > 0 ? n : defaut;
}

@Module({
  imports: [CodesModule, 
    ConfigModule,
    TypeOrmModule.forFeature([PlanAbonnement, Paiement, PaiementWebhook, ConfigurationPaiement, Abonnement, Utilisateur]),
    AbonnementsModule,
    // Chaque vérification à la demande part chez le prestataire : la limite
    // le protège lui, et nous garde sous ses propres quotas.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { name: 'paiements-burst', ttl: 60_000, limit: entierPositif(config.get<string>('PAIEMENT_VERIFICATION_RATE_LIMIT_BURST'), 10) },
          { name: 'paiements-hourly', ttl: 3_600_000, limit: entierPositif(config.get<string>('PAIEMENT_VERIFICATION_RATE_LIMIT_HOURLY'), 120) },
        ],
      }),
    }),
  ],
  controllers: [PaiementsController, PaiementsAdminController, WebhooksController],
  providers: [
    PaiementsService,
    PaiementCredentialsService,
    PaiementVerificationRateLimitGuard,
    KkiaPayProvider,
    FedaPayProvider,
    StripeProvider,
    RevenueCatProvider,
    {
      provide: PAIEMENT_PROVIDERS,
      useFactory: (kkia: KkiaPayProvider, feda: FedaPayProvider, stripe: StripeProvider, revenuecat: RevenueCatProvider) => [kkia, feda, stripe, revenuecat],
      inject: [KkiaPayProvider, FedaPayProvider, StripeProvider, RevenueCatProvider],
    },
    PaiementProviderRegistry,
  ],
  exports: [PaiementsService],
})
export class PaiementsModule {}
