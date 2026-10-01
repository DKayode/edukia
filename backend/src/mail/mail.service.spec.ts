import { MailService } from './mail.service';

describe('MailService — expéditeur no-reply', () => {
  function construire(env: Record<string, string | undefined>) {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    const config = { get: (cle: string) => env[cle] } as any;
    const pays = { getAppConfig: () => ({ name: 'Edukia', logo: '' }) } as any;
    const service = new MailService(config, pays);
    (service as any).transporter = { sendMail };
    return { service, sendMail };
  }

  const SMTP = { SMTP_USER: 'support@educ-prime.cloud' };

  it('sans MAIL_NO_REPLY_FROM : From inchangé, Reply-To no-reply du même domaine', async () => {
    const { service, sendMail } = construire(SMTP);
    await service.sendResetCode('a@b.c', '123456');

    const options = sendMail.mock.calls[0][0];
    expect(options.from).toBe('"Edukia" <support@educ-prime.cloud>');
    expect(options.replyTo).toContain('<no-reply@educ-prime.cloud>');
  });

  it('avec MAIL_NO_REPLY_FROM : From et Reply-To sur l’adresse no-reply', async () => {
    const { service, sendMail } = construire({ ...SMTP, MAIL_NO_REPLY_FROM: ' no-reply@edukia.net ' });
    await service.sendVerifyEmailCode('a@b.c', '123456');

    const options = sendMail.mock.calls[0][0];
    expect(options.from).toBe('"Edukia" <no-reply@edukia.net>');
    expect(options.replyTo).toContain('<no-reply@edukia.net>');
  });

  it('signale un envoi automatique et le dit dans le pied de page', async () => {
    const { service, sendMail } = construire(SMTP);
    await service.sendServiceStatusUpdateEmail('a@b.c', 'Awa', 'Bac 2024', 'declined', 'épreuve', 'Flou');
    await service.sendRecruteurStatusUpdateEmail('a@b.c', 'Awa', 'approved');
    await service.sendPersonalizedEmail('a@b.c', 'Sujet', '<p>Bonjour</p>');

    expect(sendMail).toHaveBeenCalledTimes(3);
    for (const [options] of sendMail.mock.calls) {
      expect(options.headers).toEqual({
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      });
      expect(options.replyTo).toContain('no-reply@');
      expect(options.html).toContain('merci de ne pas y répondre');
    }
  });
});
