import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationPriority, NotificationType } from '../notifications/entities/notification.entity';
import { Utilisateur } from '../utilisateurs/entities/utilisateur.entity';
import { Abonnement } from './entities/abonnement.entity';

/**
 * Annonce à l'abonné que son abonnement est actif — par notification et par
 * courriel.
 *
 * Les deux canaux sont voulus, et ne font pas double emploi : la notification
 * arrive sur l'écran de l'utilisateur au moment où il attend, le courriel lui
 * reste comme trace de l'achat. Un compte sur deux n'a pas de jeton FCM en
 * production ; sans le courriel, la moitié des abonnés n'apprendraient rien.
 *
 * Rien de ce qui suit ne doit faire échouer une activation. Un abonnement payé
 * reste payé même si la notification se perd.
 */
@Injectable()
export class AbonnementNotificationsService {
  private readonly logger = new Logger(AbonnementNotificationsService.name);

  constructor(
    @InjectRepository(Utilisateur) private readonly utilisateurs: Repository<Utilisateur>,
    private readonly mail: MailService,
    // NotificationsModule importe UtilisateursModule, qui redescend jusqu'ici :
    // l'importer refermerait un cycle que même forwardRef ne dénoue pas à
    // cette profondeur. On va chercher le service dans le conteneur au moment
    // de s'en servir.
    private readonly moduleRef: ModuleRef,
  ) {}

  private get notifications(): NotificationsService {
    return this.moduleRef.get(NotificationsService, { strict: false });
  }

  async annoncerActivation(abonnement: Abonnement): Promise<void> {
    const abonne = await this.utilisateurs.findOne({ where: { id: abonnement.utilisateur_id } });
    if (!abonne) {
      this.logger.warn(`Abonnement ${abonnement.uuid} : abonné introuvable, aucune annonce envoyée.`);
      return;
    }

    const echeance = this.formaterEcheance(abonnement.date_fin);
    const libellePlan = abonnement.plan?.libelle ?? abonnement.plan?.code ?? 'Abonnement Edukia';

    // Les deux canaux sont indépendants : l'échec de l'un ne prive pas
    // l'abonné de l'autre.
    await Promise.allSettled([
      this.envoyerNotification(abonne, abonnement, libellePlan, echeance),
      this.envoyerCourriel(abonne, libellePlan, echeance),
    ]);
  }

  private async envoyerNotification(
    abonne: Utilisateur,
    abonnement: Abonnement,
    libellePlan: string,
    echeance: string | null,
  ): Promise<void> {
    if (!abonne.fcm_token) {
      // Pas d'appareil enregistré : le courriel reste le seul canal. On ne
      // met pas la file en mouvement pour rien.
      this.logger.log(`Abonnement ${abonnement.uuid} : aucun jeton FCM, annonce par courriel seulement.`);
      return;
    }

    try {
      await this.notifications.sendNotification({
        title: 'Votre abonnement est actif',
        body: echeance
          ? `${libellePlan} — accès complet jusqu'au ${echeance}.`
          : `${libellePlan} — votre accès complet est ouvert.`,
        utilisateurIds: [abonne.id],
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.HIGH,
        // Les données permettent au mobile d'ouvrir directement l'écran de
        // l'abonnement plutôt que la liste des notifications.
        data: {
          categorie: 'ABONNEMENT_ACTIVE',
          abonnement_uuid: abonnement.uuid,
          date_fin: abonnement.date_fin ? abonnement.date_fin.toISOString() : '',
        },
      });
    } catch (err) {
      this.logger.warn(`Abonnement ${abonnement.uuid} : notification non envoyée — ${err?.message ?? err}`);
    }
  }

  private async envoyerCourriel(
    abonne: Utilisateur,
    libellePlan: string,
    echeance: string | null,
  ): Promise<void> {
    if (!abonne.email) {
      this.logger.warn(`Abonné ${abonne.id} : aucune adresse de courriel.`);
      return;
    }

    try {
      await this.mail.sendPersonalizedEmail(
        abonne.email,
        'Votre abonnement Edukia est actif',
        `<p>Bonjour ${abonne.prenom ?? ''},</p>
         <p>Votre abonnement <strong>${libellePlan}</strong> est actif.</p>
         ${echeance ? `<p>Il vous ouvre l'accès complet aux épreuves, aux examens nationaux et aux concours jusqu'au <strong>${echeance}</strong>.</p>` : `<p>Il vous ouvre l'accès complet aux épreuves, aux examens nationaux et aux concours.</p>`}
         <p>Vous n'avez rien à faire : l'accès est déjà ouvert dans l'application.</p>
         <p>Vous retrouverez le détail de votre abonnement et son échéance depuis votre espace personnel.</p>`,
      );
    } catch (err) {
      this.logger.warn(`Abonné ${abonne.id} : courriel d'activation non envoyé — ${err?.message ?? err}`);
    }
  }

  /** `null` plutôt qu'une date inventée : un abonnement sans échéance existe. */
  private formaterEcheance(date: Date | null | undefined): string | null {
    if (!date) return null;
    const valeur = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(valeur.getTime())) return null;
    return valeur.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
}
