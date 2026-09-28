import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { WebhooksController } from './webhooks.controller';
import { PaiementsService } from './paiements.service';
import { PaiementCredentialsService } from './paiement-credentials.service';
import { PaiementProviderRegistry } from './providers/paiement-provider.registry';
import { FedaPayProvider } from './providers/fedapay.provider';
import { ModePaiement, PrestatairePaiement, StatutPaiement } from './shared/paiement.enums';

const SECRET = 'wh_live_test_Zx9Qe3fKd8';
const URL = '/paiements/webhooks/fedapay';

// Signature telle que la calcule le SDK FedaPay (WebhookSignature::computeSignature) :
// HMAC-SHA256 de "<t>.<payload brut>", en-tête "t=<t>,s=<hex>".
const signer = (raw: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;

// json_encode PHP : slashes et accents échappés — un JSON.stringify du corps parsé
// ne redonne PAS ces octets, d'où la nécessité du corps brut.
const evenementPhp = (id: number, transactionId: number) =>
  `{"name":"transaction.approved","object":"transaction","entity":{"id":${transactionId},` +
  `"reference":"trx_${transactionId}","description":"Abonnement Edukia EDK-1 \\u00e9t\\u00e9",` +
  `"amount":2000,"status":"approved","currency":{"iso":"XOF"},` +
  `"callback_url":"https:\\/\\/api.educ-prime.com\\/paiements\\/webhooks\\/fedapay",` +
  `"metadata":{"reference":"EDK-1"}},"id":${id}}`;

describe('Webhook FedaPay (HTTP, corps brut, signature officielle)', () => {
  let app: INestApplication;
  let webhooksSaved: any[];
  let paiement: any;
  let configs: any[];
  let credentials: PaiementCredentialsService;
  let verifierStatut: jest.SpyInstance;
  let activerApresPaiement: jest.Mock;

  const configLive = (webhookSecret: string) => ({
    id: 1,
    pays: 'benin',
    prestataire: PrestatairePaiement.FEDAPAY,
    mode: ModePaiement.LIVE,
    est_actif: true,
    credentials_chiffres: credentials.encrypt({ secret_key: 'sk_live_x', webhook_secret: webhookSecret }),
  });

  beforeEach(async () => {
    const configService: any = { get: jest.fn((k: string, d?: any) => (k === 'JWT_SECRET' ? 'jwt' : d)) };
    credentials = new PaiementCredentialsService(configService);
    const fedapay = new FedaPayProvider(configService);
    verifierStatut = jest
      .spyOn(fedapay, 'verifierStatut')
      .mockResolvedValue({ statut: StatutPaiement.REUSSI, montant: 2000, devise: 'XOF' });

    webhooksSaved = [];
    configs = [configLive(SECRET)];
    paiement = {
      id: 7, uuid: 'p-7', pays: 'benin', reference: 'EDK-1', reference_prestataire: '4242',
      prestataire: PrestatairePaiement.FEDAPAY, mode: ModePaiement.LIVE,
      statut: StatutPaiement.EN_ATTENTE, montant: 2000, abonnement_id: 11, payload_confirmation: {},
    };
    activerApresPaiement = jest.fn().mockResolvedValue(undefined);

    const webhooksRepo = {
      create: (v: any) => v,
      save: jest.fn(async (v: any) => {
        if (webhooksSaved.some((w) => w.evenement_id === v.evenement_id)) throw { code: '23505' };
        const ligne = { ...v, id: webhooksSaved.length + 1 };
        webhooksSaved.push(ligne);
        return ligne;
      }),
      update: jest.fn(async (id: number, champs: any) => Object.assign(webhooksSaved[id - 1], champs)),
    };
    const paiementsRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.reference_prestataire === paiement.reference_prestataire || where.reference === paiement.reference
          ? paiement : null),
      save: jest.fn(async (v: any) => v),
    };
    const configurationsRepo = {
      find: jest.fn(async ({ where }: any) =>
        configs.filter((c) => c.prestataire === where.prestataire && c.est_actif === where.est_actif)),
      findOne: jest.fn(async ({ where }: any) =>
        configs.find((c) => c.prestataire === where.prestataire && c.mode === where.mode) ?? null),
    };
    const abonnementsRepo = { findOne: jest.fn().mockResolvedValue({ id: 11, uuid: 'abo-11' }) };

    const service = new PaiementsService(
      paiementsRepo as any, webhooksRepo as any, configurationsRepo as any, abonnementsRepo as any,
      {} as any, {} as any,
      new PaiementProviderRegistry([fedapay]),
      { activerApresPaiement } as any,
      {} as any, credentials, {} as any, {} as any, configService,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: PaiementsService, useValue: service }],
    }).compile();
    // Même option que main.ts : sans elle, req.rawBody est absent.
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
  });

  afterEach(() => app.close());

  const envoyer = (raw: string, signature: string | null, contentType = 'application/json') => {
    const req = request(app.getHttpServer()).post(URL).set('Content-Type', contentType);
    if (signature) req.set('X-FEDAPAY-SIGNATURE', signature);
    return req.send(raw);
  };

  it('accepte un évènement signé (JSON PHP échappé) et active l’abonnement', async () => {
    const raw = evenementPhp(9001, 4242);
    const res = await envoyer(raw, signer(raw));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(webhooksSaved[0]).toMatchObject({ evenement_id: '9001', signature_valide: true, traite: true });
    expect(verifierStatut).toHaveBeenCalledWith('4242', expect.objectContaining({ secret_key: 'sk_live_x' }), ModePaiement.LIVE);
    expect(activerApresPaiement).toHaveBeenCalledWith('abo-11', expect.objectContaining({ montant: 2000 }));
  });

  it('accepte avec Content-Type application/json; charset=utf-8', async () => {
    const raw = evenementPhp(9002, 4242);
    const res = await envoyer(raw, signer(raw), 'application/json; charset=utf-8');
    expect(res.status).toBe(201);
  });

  it('répond 2xx à un évènement signé sans paiement connu (ex. transaction hors Edukia)', async () => {
    const raw = evenementPhp(9003, 5555).replace('"EDK-1"', '"AUTRE"');
    const res = await envoyer(raw, signer(raw));
    expect(res.status).toBe(201);
    expect(webhooksSaved[0].erreur_traitement).toBe('PAIEMENT_INTROUVABLE_IGNORE');
  });

  it('un rejeu du même évènement répond 2xx sans retraiter', async () => {
    const raw = evenementPhp(9004, 4242);
    await envoyer(raw, signer(raw));
    const res = await envoyer(raw, signer(raw));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(activerApresPaiement).toHaveBeenCalledTimes(1);
  });

  it('refuse (401) une signature faite avec un autre secret', async () => {
    const raw = evenementPhp(9005, 4242);
    const res = await envoyer(raw, signer(raw, 'wh_sandbox_autre'));
    expect(res.status).toBe(401);
    expect(webhooksSaved[0]).toMatchObject({ signature_valide: false, erreur_traitement: 'SIGNATURE_INVALIDE' });
  });

  it('refuse (401) sans en-tête de signature', async () => {
    const raw = evenementPhp(9006, 4242);
    expect((await envoyer(raw, null)).status).toBe(401);
  });

  it('accepte un secret collé avec des espaces ou un retour à la ligne', async () => {
    configs = [configLive(`  ${SECRET}\n`)];
    const raw = evenementPhp(9007, 4242);
    expect((await envoyer(raw, signer(raw))).status).toBe(201);
  });

  it('des identifiants indéchiffrables donnent un 401 journalisé, pas un 500', async () => {
    const autreCle = new PaiementCredentialsService({ get: (k: string) => (k === 'JWT_SECRET' ? 'autre' : undefined) } as any);
    configs = [{ ...configLive(SECRET), credentials_chiffres: autreCle.encrypt({ webhook_secret: SECRET }) }];
    const raw = evenementPhp(9009, 4242);
    const res = await envoyer(raw, signer(raw));
    expect(res.status).toBe(401);
    expect(webhooksSaved[0].erreur_traitement).toBe('CREDENTIALS_INDECHIFFRABLES');
  });

  it('accepte un en-tête portant plusieurs signatures (rotation du secret)', async () => {
    const raw = evenementPhp(9008, 4242);
    const t = Math.floor(Date.now() / 1000);
    const bonne = createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
    const res = await envoyer(raw, `t=${t},s=${bonne},s=${'0'.repeat(64)}`);
    expect(res.status).toBe(201);
  });
});
