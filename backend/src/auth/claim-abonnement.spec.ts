import { AuthService } from './auth.service';

/**
 * Le claim `abonnement_actif` du jeton, posé pour Ketsia (contrat
 * d'intégration du 11/09). Ce qui se teste ici est son exactitude au moment de
 * l'émission, et surtout qu'une panne de lecture n'empêche pas de se connecter.
 */
describe('AuthService — claim d’abonnement dans le jeton', () => {
  let jwt: any, entitlement: any, service: AuthService;

  const utilisateur = { id: 7, email: 'jane@example.com', role: 'étudiant' };
  const payload = () => jwt.sign.mock.calls[0][0];

  beforeEach(() => {
    jwt = { sign: jest.fn().mockReturnValue('jeton') };
    entitlement = { hasActiveSubscription: jest.fn().mockResolvedValue(false) };
    service = new AuthService({} as any, jwt, {} as any, {} as any, entitlement);
  });

  const fabriquer = () => (service as any).payloadJeton(utilisateur);

  it('pose le claim à false pour un compte sans abonnement', async () => {
    const p = await fabriquer();
    expect(p).toEqual({
      sub: 7,
      email: 'jane@example.com',
      role: 'étudiant',
      abonnement_actif: false,
    });
  });

  it('le pose à true pour un abonné', async () => {
    entitlement.hasActiveSubscription.mockResolvedValue(true);
    expect((await fabriquer()).abonnement_actif).toBe(true);
  });

  it('emploie le nom et la forme attendus par Ketsia', async () => {
    // À plat et booléen, comme AI_PREMIUM_CLAIM par défaut : aucune
    // configuration nécessaire côté Ketsia. Renommer ce claim casse
    // l'intégration en silence, le quota IA se réappliquant aux abonnés.
    const p = await fabriquer();
    expect(Object.keys(p)).toContain('abonnement_actif');
    expect(typeof p.abonnement_actif).toBe('boolean');
  });

  it('ne bloque pas la connexion si l’abonnement est illisible', async () => {
    entitlement.hasActiveSubscription.mockRejectedValue(new Error('base indisponible'));
    const p = await fabriquer();
    // Un abonné verra son quota IA le temps d'un rafraîchissement — préférable
    // à un refus de connexion pour tout le monde.
    expect(p.abonnement_actif).toBe(false);
    expect(p.sub).toBe(7);
  });

  it('n’interroge l’abonnement qu’une fois par jeton', async () => {
    await fabriquer();
    expect(entitlement.hasActiveSubscription).toHaveBeenCalledTimes(1);
    expect(entitlement.hasActiveSubscription).toHaveBeenCalledWith(7);
  });
});
