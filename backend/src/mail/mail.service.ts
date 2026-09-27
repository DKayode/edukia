import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { CountryConfigService } from '../config/country-config.service';

/**
 * Les titres et noms viennent de données utilisateur (titre d'une soumission,
 * nom du compte) : ne jamais les injecter bruts dans le HTML d'un mail.
 */
function escapeHtml(value: string): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(MailService.name);
    /**
     * Cached app logo bytes for inline email attachment (cid:edukia-logo).
     * We download once on first send and reuse — most email clients block
     * remote images, so we keep the CID attachment shape rather than
     * pointing the <img src> at the URL directly.
     */
    private logoBuffer: Buffer | null = null;
    private logoFetchPromise: Promise<Buffer | null> | null = null;
    private get appName(): string { return this.countryConfig.getAppConfig().name; }
    private get appLogoUrl(): string { return this.countryConfig.getAppConfig().logo; }

    constructor(
        private configService: ConfigService,
        private countryConfig: CountryConfigService,
    ) {
        this.initTransporter();
    }

    /** Fetch the app logo once, cache the bytes for the life of the process. */
    private async loadLogo(): Promise<Buffer | null> {
        if (this.logoBuffer) return this.logoBuffer;
        if (this.logoFetchPromise) return this.logoFetchPromise;
        const url = this.appLogoUrl;
        if (!url) return null;

        this.logoFetchPromise = (async () => {
            try {
                const r = await fetch(url);
                if (!r.ok) {
                    this.logger.warn(`Failed to fetch app logo from ${url}: ${r.status}`);
                    return null;
                }
                const ab = await r.arrayBuffer();
                this.logoBuffer = Buffer.from(ab);
                this.logger.log(`Cached app logo (${this.logoBuffer.length} bytes) from ${url}`);
                return this.logoBuffer;
            } catch (err) {
                this.logger.warn(`Failed to fetch app logo from ${url}: ${(err as Error).message}`);
                return null;
            }
        })();
        return this.logoFetchPromise;
    }

    /**
     * Build the attachments array for a transactional mail. Returns an empty
     * array if the logo wasn't fetchable — the email still sends, the
     * <img cid:edukia-logo> just renders broken in clients that don't ignore
     * it. Cheap fallback that doesn't hold up SMTP.
     */
    private async logoAttachment(): Promise<Array<{ filename: string; content: Buffer; cid: string }>> {
        const buf = await this.loadLogo();
        if (!buf) return [];
        const ext = (this.appLogoUrl.split('.').pop() ?? 'png').toLowerCase();
        return [{ filename: `logo.${ext}`, content: buf, cid: 'edukia-logo' }];
    }

    private initTransporter() {
        const host = this.configService.get<string>('SMTP_HOST');
        const port = Number(this.configService.get<number>('SMTP_PORT'));
        const user = this.configService.get<string>('SMTP_USER');
        const pass = this.configService.get<string>('SMTP_PASS');
        const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

        if (host && user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure, // true for 465, false for other ports
                auth: {
                    user,
                    pass,
                },
                // Sous le délai de 30 s de l'app mobile : un SMTP lent doit échouer
                // proprement plutôt que faire expirer la requête côté client.
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 15000,
                pool: true, // Reuse connections
                maxConnections: 3, // Smaller pool for safety
                maxMessages: 100, // Max messages per connection before reconnecting
                rateDelta: 1000, // 1 second
                rateLimit: 1, // 1 email per second max (Extremely safe)
            });
            this.logger.log(`MailService initialized with host: ${host}`);
        } else {
            this.logger.error('SMTP configuration missing (host, user or pass). Emails cannot be sent.');
        }
    }

    private wrapHtmlTemplate(content: string, title?: string): string {
        const docTitle = title ?? this.appName;
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${docTitle}</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f6f8; padding: 20px 0;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin: 0 auto; min-width: 320px; max-width: 600px;">
                            <!-- Header -->
                            <tr>
                                <td style="padding: 24px; text-align: center; border-bottom: 3px solid #009a44; background-color: #ffffff;">
                                    <img src="cid:edukia-logo" alt="Edukia Logo" style="max-height: 40px; vertical-align: middle; margin-right: 12px; border: none;">
                                    <h1 style="display: inline-block; margin: 0; font-size: 28px; vertical-align: middle; font-weight: 800; letter-spacing: -0.5px;"><span style="color: #009a44;">EDU</span><span style="color: #000000;">KIA</span></h1>
                                </td>
                            </tr>
                            <!-- Content -->
                            <tr>
                                <td style="padding: 32px; color: #334155; font-size: 16px; line-height: 1.6;">
                                    ${content}
                                </td>
                            </tr>
                            <!-- Footer -->
                            <tr>
                                <td style="padding: 24px; text-align: center; font-size: 13px; color: #94a3b8; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
                                    &copy; ${new Date().getFullYear()} Edukia. Tous droits réservés.<br/>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;
    }

    /**
     * `renvoi` distingue le second envoi du premier : sans cette mention, un
     * utilisateur qui a demandé deux codes saisit celui du premier email et se
     * voit refuser sans comprendre pourquoi.
     */
    async sendResetCode(email: string, code: string, renvoi = false) {
        if (!this.transporter) {
            throw new Error('SMTP configuration missing. Cannot send email.');
        }

        const from = this.configService.get<string>('SMTP_USER') || 'support@educ-prime.cloud';
        const titre = renvoi ? 'Votre nouveau code de vérification' : 'Réinitialisation de mot de passe';
        const introduction = renvoi
            ? `<p>Voici votre <strong>nouveau</strong> code de vérification.</p>
               <p style="font-size: 14px; color: #b45309;">Les codes envoyés précédemment ne sont plus valables.</p>`
            : `<p>Vous avez demandé la réinitialisation de votre mot de passe.</p>`;

        const innerContent = `
        <h2 style="color: #0f172a; margin-top: 0;">${titre}</h2>
        ${introduction}
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; border-radius: 6px; margin: 24px 0;">
            <p style="margin: 0; font-size: 14px; color: #64748b;">Votre code de vérification est :</p>
            <p style="margin: 8px 0 0 0; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #009a44;">${code}</p>
        </div>
        <p>Ce code expire dans <strong>15 minutes</strong>.</p>
        <p style="font-size: 14px; color: #64748b;">Si vous n'êtes pas à l'origine de cette demande, veuillez ignorer cet email et sécuriser votre compte.</p>
        <br/>
        <p>L'équipe Edukia</p>
        `;

        const mailOptions = {
            from: `"${this.appName}" <${from}>`,
            to: email,
            subject: renvoi ? 'Votre nouveau code de réinitialisation' : 'Réinitialisation de votre mot de passe',
            html: this.wrapHtmlTemplate(innerContent, titre),
            attachments: await this.logoAttachment()
        };

        try {
            await this.transporter.sendMail(mailOptions);
            this.logger.log(`Reset code email sent to ${email}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${email}: ${error.message}`, error.stack);
            throw error;
        }
    }

    async sendVerifyEmailCode(email: string, code: string) {
        if (!this.transporter) {
            throw new Error('SMTP configuration missing. Cannot send email.');
        }

        const from = this.configService.get<string>('SMTP_USER') || 'support@educ-prime.cloud';
        const innerContent = `
        <h2 style="color: #0f172a; margin-top: 0;">Vérification d'email</h2>
        <p>Merci de vous être inscrit sur Edukia ! Voici votre code de vérification :</p>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; border-radius: 6px; margin: 24px 0;">
            <p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #009a44;">${code}</p>
        </div>
        <p>Ce code expire dans <strong>1 jour</strong>.</p>
        <br/>
        <p>L'équipe Edukia</p>
        `;

        const mailOptions = {
            from: `"${this.appName}" <${from}>`,
            to: email,
            subject: 'Vérification de votre adresse email',
            html: this.wrapHtmlTemplate(innerContent, 'Vérification d\'email'),
            attachments: await this.logoAttachment()
        };

        try {
            await this.transporter.sendMail(mailOptions);
            this.logger.log(`Verification code email sent to ${email}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${email}: ${error.message}`, error.stack);
            throw new Error("Erreur lors de l'envoi de l'email");
        }
    }

    async sendServiceStatusUpdateEmail(email: string, userName: string, serviceTitle: string, status: string, entityType: string = 'service', reason?: string) {
        if (!this.transporter) {
            this.logger.warn(`SMTP configuration missing. Cannot send ${entityType} status email.`);
            return;
        }

        const from = this.configService.get<string>('SMTP_USER') || 'support@educ-prime.cloud';

        let statusText = '';
        let messageHtml = '';
        // Contenus déposés par les utilisateurs : leur approbation crédite le
        // wallet, donc le mail parle de gains. Les autres entités qui passent
        // par cette méthode (offres JobKia…) ne rapportent rien — elles gardent
        // le message neutre plus bas.
        const CONTENUS_RECOMPENSES: Record<string, { approuve: string }> = {
            'épreuve': { approuve: 'approuvée' },   // féminin
            'examen national': { approuve: 'approuvé' },
            'concours': { approuve: 'approuvé' },
        };

        if ((status === 'active' || status === 'approved') && CONTENUS_RECOMPENSES[entityType]) {
            const accord = CONTENUS_RECOMPENSES[entityType].approuve;
            statusText = accord;
            messageHtml = `
        <p>Excellente nouvelle ! 🎉</p>
        <p>Votre ${entityType} «&nbsp;<strong>${escapeHtml(serviceTitle)}</strong>&nbsp;» a été <strong>${accord}</strong> et est désormais visible par tous les utilisateurs sur EDUKIA.</p>
        <p>Les revenus générés grâce à vos contenus sont disponibles dans votre <strong>Wallet EDUKIA</strong>.</p>
        <p>Le retrait de vos gains via Mobile Money sera disponible dès la semaine prochaine. Vous recevrez directement une notification dans l'application vous invitant à renseigner votre numéro Mobile Money afin que nous puissions effectuer le transfert.</p>
        <p>Merci pour votre confiance et votre contribution à la communauté EDUKIA.</p>`;
        } else if (status === 'active' || status === 'approved') {
            // Entités sans récompense (offres JobKia…) : message neutre inchangé.
            statusText = 'approuvé';
            messageHtml = `<p>Excellente nouvelle ! Votre ${entityType} <strong>"${escapeHtml(serviceTitle)}"</strong> a été <strong>approuvé</strong> et est maintenant visible par tous les utilisateurs.</p>`;
        } else if (status === 'declined') {
            statusText = 'refusé';
            const reasonHtml = reason && reason.trim()
                ? `<p><strong>Motif :</strong> ${escapeHtml(reason.trim())}</p>`
                : '';
            messageHtml = `<p>Nous sommes au regret de vous informer que votre ${entityType} <strong>"${escapeHtml(serviceTitle)}"</strong> a été <strong>refusé</strong>.</p>${reasonHtml}`;
        } else {
            // Optional: don't send emails for other status changes
            return;
        }

        const remerciement = CONTENUS_RECOMPENSES[entityType] && (status === 'active' || status === 'approved')
            ? ''                                    // déjà dit dans le message ci-dessus
            : `<br/><p>Merci pour votre confiance,</p>`;

        const innerContent = `
        <h2 style="color: #0f172a; margin-top: 0;">Bonjour ${escapeHtml(userName)},</h2>
        ${messageHtml}
        ${remerciement}
        <p>L'équipe Edukia</p>
        `;

        const mailOptions = {
            from: `"${this.appName}" <${from}>`,
            to: email,
            subject: `Mise à jour de votre ${entityType} : ${statusText}`,
            html: this.wrapHtmlTemplate(innerContent, `Mise à jour de ${entityType}`),
            attachments: await this.logoAttachment()
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            this.logger.log(`Service status update email sent to ${email}. MessageId: ${info.messageId}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${email}: ${error.message}`, error.stack);
            throw new Error("Erreur lors de l'envoi de l'email");
        }
    }

    async sendRecruteurStatusUpdateEmail(email: string, userName: string, status: string) {
        if (!this.transporter) {
            this.logger.warn('SMTP configuration missing. Cannot send recruteur status email.');
            return;
        }

        const from = this.configService.get<string>('SMTP_USER') || 'support@educ-prime.cloud';

        let statusText = '';
        let messageHtml = '';

        if (status === 'active' || status === 'approved') {
            statusText = 'approuvé';
            messageHtml = `
                <p>Félicitations ! Votre profil de <strong>Recruteur</strong> a été <strong>approuvé</strong>.</p>
                <p>Vous pouvez dès à présent vous connecter et commencer à publier des offres sur notre plateforme.</p>
            `;
        } else if (status === 'declined') {
            statusText = 'refusé';
            messageHtml = `
                <p>Nous sommes au regret de vous informer que votre profil de <strong>Recruteur</strong> a été <strong>refusé</strong>.</p>
                <p>Si vous pensez qu'il s'agit d'une erreur ou si vous souhaitez plus d'informations, n'hésitez pas à nous contacter.</p>
            `;
        } else {
            return;
        }

        const innerContent = `
        <h2 style="color: #0f172a; margin-top: 0;">Bonjour ${userName},</h2>
        ${messageHtml}
        <br/>
        <p>Merci pour votre engagement,</p>
        <p>L'équipe Edukia</p>
        `;

        const mailOptions = {
            from: `"${this.appName}" <${from}>`,
            to: email,
            subject: `Mise à jour de votre profil Recruteur : ${statusText}`,
            html: this.wrapHtmlTemplate(innerContent, 'Mise à jour profil Recruteur'),
            attachments: await this.logoAttachment()
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            this.logger.log(`Recruteur status update email sent to ${email}. MessageId: ${info.messageId}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${email}: ${error.message}`, error.stack);
            throw new Error("Erreur lors de l'envoi de l'email");
        }
    }

    async sendPersonalizedEmail(email: string, subject: string, htmlMessage: string) {
        if (!this.transporter) {
            this.logger.warn('SMTP configuration missing. Cannot send personalized email.');
            return;
        }

        const from = this.configService.get<string>('SMTP_USER') || 'support@educ-prime.cloud';

        const mailOptions = {
            from: `"${this.appName}" <${from}>`,
            to: email, // Sending directly uniquely
            subject: subject,
            html: this.wrapHtmlTemplate(htmlMessage, subject),
            attachments: await this.logoAttachment()
        };

        try {
            this.logger.log(`SMTP: Attempting to send personalized email to ${email}`);
            await this.transporter.sendMail(mailOptions);
            this.logger.log(`SMTP: Successfully sent email to ${email}`);
        } catch (error) {
            this.logger.error(`Failed to send personalized email: ${error.message}`, error.stack);
            throw new Error("Erreur lors de l'envoi de l'email");
        }
    }
}
