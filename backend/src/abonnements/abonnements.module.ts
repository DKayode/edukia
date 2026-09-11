import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { UtilisateursModule } from '../utilisateurs/utilisateurs.module';
import { AbonnementsAdminController } from './abonnements-admin.controller';
import { AbonnementsController } from './abonnements.controller';
import { EntitlementInternalController } from './internal/entitlement-internal.controller';
import { AbonnementsService } from './abonnements.service';
import { AbonnementEvenement } from './entities/abonnement-evenement.entity';
import { Abonnement } from './entities/abonnement.entity';
import { ConfigurationQuota } from './entities/configuration-quota.entity';
import { QuotaConsommation } from './entities/quota-consommation.entity';
import { PlanAbonnement } from './entities/plan-abonnement.entity';
import { EntitlementService } from './entitlement.service';
import { AbonnementRequisGuard } from './guards/abonnement-requis.guard';
import { ParrainageService } from './parrainage.service';
import { PlansService } from './plans.service';
import { QuotaService } from './quota.service';
import { ConfigurationAbonnement } from './entities/configuration-abonnement.entity';
import { VerrouService } from './verrou.service';

/**
 * Socle des abonnements.
 *
 * `EntitlementService` et `AbonnementRequisGuard` sont exportés : ce sont les
 * seules surfaces que les autres modules (concours ici, épreuves et examens
 * nationaux en #245, stats IA en #249) doivent connaître.
 */
@Module({
  imports: [forwardRef(() => UtilisateursModule), TypeOrmModule.forFeature([ConfigurationAbonnement, PlanAbonnement, Abonnement, AbonnementEvenement, QuotaConsommation, ConfigurationQuota, Utilisateur])],
  controllers: [AbonnementsController, AbonnementsAdminController, EntitlementInternalController],
  providers: [VerrouService, AbonnementsService, PlansService, EntitlementService, QuotaService, ParrainageService, AbonnementRequisGuard],
  exports: [VerrouService, EntitlementService, QuotaService, ParrainageService, PlansService, AbonnementRequisGuard, AbonnementsService],
})
export class AbonnementsModule {}
