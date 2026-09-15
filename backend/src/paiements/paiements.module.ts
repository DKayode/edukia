import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { PaiementsService } from './paiements.service';
import { FedaPayProvider } from './providers/fedapay.provider';
import { KkiaPayProvider } from './providers/kkiapay.provider';
import { StripeProvider } from './providers/stripe.provider';
import { RevenueCatProvider } from './providers/revenuecat.provider';
import { PaiementProviderRegistry } from './providers/paiement-provider.registry';
import { PAIEMENT_PROVIDERS } from './shared/paiement.tokens';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Paiement, PaiementWebhook, ConfigurationPaiement, Abonnement, Utilisateur]),
    AbonnementsModule,
  ],
  controllers: [PaiementsController, PaiementsAdminController, WebhooksController],
  providers: [
    PaiementsService,
    PaiementCredentialsService,
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
