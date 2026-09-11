import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UtilisateursController } from './utilisateurs.controller';
import { UtilisateursService } from './utilisateurs.service';
import { Utilisateur } from './entities/utilisateur.entity';

import { FichiersModule } from 'src/fichiers/fichiers.module';
import { NotificationUtilisateur } from 'src/notifications/entities/notification-utilisateur.entity';
import { MailModule } from 'src/mail/mail.module';
import { ProfilCompletionService } from './profil-completion.service';
import { ConfigurationProfil } from './entities/configuration-profil.entity';
import { ConfigurationProfilAdminController } from './configuration-profil-admin.controller';
import { DeviceCreditsModule } from '../device-credits/device-credits.module';

@Module({
  imports: [TypeOrmModule.forFeature([Utilisateur, NotificationUtilisateur, ConfigurationProfil]), FichiersModule, MailModule, DeviceCreditsModule],
  controllers: [ConfigurationProfilAdminController, UtilisateursController],
  providers: [ProfilCompletionService, UtilisateursService],
  exports: [ProfilCompletionService, UtilisateursService, TypeOrmModule.forFeature([Utilisateur])],
})
export class UtilisateursModule { }
