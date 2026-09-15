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
import { PermissionGuard } from '../auth/guards/permission.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Utilisateur, NotificationUtilisateur, ConfigurationProfil]), FichiersModule, MailModule],
  controllers: [ConfigurationProfilAdminController, UtilisateursController],
  providers: [ProfilCompletionService, UtilisateursService, PermissionGuard],
  exports: [ProfilCompletionService, UtilisateursService, TypeOrmModule.forFeature([Utilisateur])],
})
export class UtilisateursModule { }
