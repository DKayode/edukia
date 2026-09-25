import { AbonnementNotificationsService } from './abonnement-notifications.service';
import { NotificationPriority, NotificationType } from '../notifications/entities/notification.entity';

describe('AbonnementNotificationsService', () => {
  let utilisateurs: any;
  let mail: any;
  let notifications: any;
  let service: AbonnementNotificationsService;

  const abonnement = (surcharge: Record<string, unknown> = {}): any => ({
    id: 1,
    uuid: 'abo-1',
    utilisateur_id: 7,
    date_fin: new Date('2026-10-24T00:00:00Z'),
    plan: { libelle: 'Abonnement annuel', code: 'ANNUEL' },
    ...surcharge,
  });

  const abonne = (surcharge: Record<string, unknown> = {}): any => ({
    id: 7,
    email: 'etudiant@exemple.com',
    prenom: 'Awa',
    fcm_token: 'jeton-fcm',
    ...surcharge,
  });

  beforeEach(() => {
    utilisateurs = { findOne: jest.fn().mockResolvedValue(abonne()) };
    mail = { sendPersonalizedEmail: jest.fn().mockResolvedValue(undefined) };
    notifications = { sendNotification: jest.fn().mockResolvedValue({ success: true }) };
    // Le service va chercher NotificationsService dans le conteneur au moment
    // de s'en servir (résolution paresseuse pour éviter un cycle de modules).
    const moduleRef = { get: jest.fn().mockReturnValue(notifications) };
    service = new AbonnementNotificationsService(utilisateurs, mail, moduleRef as any);
  });

  it('prévient sur les deux canaux, avec l’échéance en clair', async () => {
    await service.annoncerActivation(abonnement());

    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Votre abonnement est actif',
        utilisateurIds: [7],
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.HIGH,
        data: expect.objectContaining({ categorie: 'ABONNEMENT_ACTIVE', abonnement_uuid: 'abo-1' }),
      }),
    );
    expect(notifications.sendNotification.mock.calls[0][0].body).toContain('24 octobre 2026');

    const [destinataire, sujet, corps] = mail.sendPersonalizedEmail.mock.calls[0];
    expect(destinataire).toBe('etudiant@exemple.com');
    expect(sujet).toBe('Votre abonnement Edukia est actif');
    expect(corps).toContain('Awa');
    expect(corps).toContain('24 octobre 2026');
  });

  it('pour un abonnement OFFERT, décrit l’accès et sa date, pas le palier du plan', async () => {
    // Code imposant 97 jours sur le plan mensuel : nommer « mensuel » serait
    // trompeur. On annonce l'accès et l'échéance réelle.
    await service.annoncerActivation(abonnement({
      offert: true,
      plan: { libelle: 'Abonnement mensuel', code: 'MENSUEL' },
      date_fin: new Date('2026-12-31T00:00:00Z'),
    }));

    const notif = notifications.sendNotification.mock.calls[0][0];
    expect(notif.title).toBe('Votre accès Edukia est activé');
    expect(notif.body).toContain('Accès complet Edukia');
    expect(notif.body).toContain('31 décembre 2026');
    expect(notif.body).not.toContain('mensuel');

    const [, sujet, corps] = mail.sendPersonalizedEmail.mock.calls[0];
    expect(sujet).toBe('Votre accès Edukia est activé');
    expect(corps).toContain('Accès complet Edukia');
    expect(corps).not.toContain('mensuel');
  });

  it('se contente du courriel quand aucun appareil n’est enregistré', async () => {
    utilisateurs.findOne.mockResolvedValue(abonne({ fcm_token: null }));

    await service.annoncerActivation(abonnement());

    expect(notifications.sendNotification).not.toHaveBeenCalled();
    expect(mail.sendPersonalizedEmail).toHaveBeenCalledTimes(1);
  });

  it('envoie quand même la notification si le courriel échoue', async () => {
    mail.sendPersonalizedEmail.mockRejectedValue(new Error('SMTP indisponible'));

    await expect(service.annoncerActivation(abonnement())).resolves.toBeUndefined();
    expect(notifications.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('envoie quand même le courriel si la notification échoue', async () => {
    notifications.sendNotification.mockRejectedValue(new Error('file indisponible'));

    await expect(service.annoncerActivation(abonnement())).resolves.toBeUndefined();
    expect(mail.sendPersonalizedEmail).toHaveBeenCalledTimes(1);
  });

  it('ne promet pas d’échéance quand l’abonnement n’en porte pas', async () => {
    await service.annoncerActivation(abonnement({ date_fin: null }));

    expect(notifications.sendNotification.mock.calls[0][0].body).not.toContain('jusqu');
    expect(mail.sendPersonalizedEmail.mock.calls[0][2]).not.toContain('jusqu’au');
  });

  it('n’écrit à personne quand l’abonné a disparu', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    await service.annoncerActivation(abonnement());

    expect(notifications.sendNotification).not.toHaveBeenCalled();
    expect(mail.sendPersonalizedEmail).not.toHaveBeenCalled();
  });
});
