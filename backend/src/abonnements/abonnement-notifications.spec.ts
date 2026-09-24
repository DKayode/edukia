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
    service = new AbonnementNotificationsService(utilisateurs, mail, notifications);
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
