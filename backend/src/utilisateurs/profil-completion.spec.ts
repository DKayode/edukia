import { ProfilCompletionService, CHAMPS_PROFIL } from './profil-completion.service';

/** Un compte tel qu'il sort de l'inscription : 4 champs remplis sur 16. */
const utilisateurNeuf = (surcharges: any = {}) => ({
  id: 1,
  nom: 'Doe', prenom: 'Jane', email: 'jane@example.com', sexe: 'F',
  pseudo: null, telephone: null, photo: null, profil_photo_path: '',
  age_group: null, zone_residence: null, departement_id: null, ville_id: null,
  etablissement_id: null, filiere_id: null, niveau_etude_id: null, type_profil_id: null,
  situation_handicap: null,
  verifier: false,
  ...surcharges,
});

const utilisateurComplet = () => ({
  id: 1,
  nom: 'Doe', prenom: 'Jane', email: 'jane@example.com', sexe: 'F',
  pseudo: 'jane', telephone: '+22901000000', photo: null, profil_photo_path: '/x/y/profil',
  age_group: '18 - 25', zone_residence: 'urbaine', departement_id: 'd-1', ville_id: 'v-1',
  etablissement_id: 1, filiere_id: 2, niveau_etude_id: 3, type_profil_id: 4,
  situation_handicap: false,
  verifier: true,
});

describe('ProfilCompletionService', () => {
  let utilisateurs: any, configurations: any, dataSource: any, service: ProfilCompletionService;

  const config = (surcharges: any = {}) =>
    configurations.findOne.mockResolvedValue({
      uuid: 'c-1', seuil_completion: 95, est_actif: false, champs_exclus: null, ...surcharges,
    });

  beforeEach(() => {
    utilisateurs = { findOne: jest.fn().mockResolvedValue(utilisateurNeuf()) };
    configurations = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn(async (c) => c) };
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    service = new ProfilCompletionService(utilisateurs, configurations, dataSource);
  });

  describe('champs comptés', () => {
    it('compte situation_handicap', () => {
      expect(CHAMPS_PROFIL.map((c) => c.champ)).toContain('situation_handicap');
    });

    it('ne compte pas l’adresse email à part de sa vérification', () => {
      // Sans adresse il n'y a pas de compte : la compter créditerait tout le
      // monde d'un point acquis d'avance. Seule la vérification distingue.
      const champs = CHAMPS_PROFIL.map((c) => c.champ);
      expect(champs).not.toContain('email');
      expect(champs).toContain('email_verifie');
    });

    it('en compte toujours seize', () => {
      expect(CHAMPS_PROFIL).toHaveLength(16);
    });

    it('donne un libellé lisible à chaque champ', () => {
      // La liste `manquants` est destinée à l'utilisateur : un nom de colonne
      // n'y a pas sa place.
      expect(CHAMPS_PROFIL.every((c) => c.libelle && c.libelle !== c.champ)).toBe(true);
    });
  });

  describe('calcul', () => {
    it('compte 19 % pour un compte fraîchement inscrit', async () => {
      config();
      const c = await service.pourUtilisateur(1);
      // nom, prénom, sexe — l'adresse email ne compte plus pour elle-même.
      expect(c).toMatchObject({ champs_total: 16, champs_remplis: 3, pourcentage: 19 });
    });

    it('compte 100 % pour un profil entièrement rempli', async () => {
      config();
      utilisateurs.findOne.mockResolvedValue(utilisateurComplet());
      expect((await service.pourUtilisateur(1)).pourcentage).toBe(100);
    });

    it('traite une chaîne vide comme un champ vide', async () => {
      // `profil_photo_path` vaut '' par défaut, pas NULL : le compter comme
      // rempli créditerait une photo que personne n'a envoyée.
      config();
      const c = await service.pourUtilisateur(1);
      expect(c.manquants.map((m) => m.champ)).toContain('photo');
    });

    it('accepte la photo héritée comme la nouvelle', async () => {
      config();
      utilisateurs.findOne.mockResolvedValue(utilisateurNeuf({ photo: 'https://legacy/x.png' }));
      expect((await service.pourUtilisateur(1)).manquants.map((m) => m.champ)).not.toContain('photo');
    });

    it('liste les champs manquants avec leur libellé', async () => {
      config();
      const c = await service.pourUtilisateur(1);
      expect(c.manquants).toHaveLength(13);
      expect(c.manquants).toContainEqual({ champ: 'telephone', libelle: 'Numéro de téléphone' });
    });

    it('compte un « non » au handicap comme une réponse', async () => {
      config();
      utilisateurs.findOne.mockResolvedValue(utilisateurNeuf({ situation_handicap: false }));
      const c = await service.pourUtilisateur(1);
      expect(c.manquants.map((m) => m.champ)).not.toContain('situation_handicap');
      expect(c.champs_remplis).toBe(4);
    });

    it('laisse le handicap vide tant que la question n’a pas été posée', async () => {
      // NULL depuis la migration 088 : sans elle, DEFAULT false remplissait le
      // champ à l'inscription et personne n'avait jamais rien à répondre.
      config();
      const c = await service.pourUtilisateur(1);
      expect(c.manquants.map((m) => m.champ)).toContain('situation_handicap');
    });

    it('n’accorde plus l’adresse email comme un point acquis', async () => {
      config();
      const c = await service.pourUtilisateur(1);
      expect(c.manquants.map((m) => m.champ)).not.toContain('email');
      expect(c.manquants.map((m) => m.champ)).toContain('email_verifie');
    });

    it('retire les champs exclus du calcul ET du dénominateur', async () => {
      config({ champs_exclus: ['pseudo', 'telephone', 'photo', 'type_profil_id'] });
      const c = await service.pourUtilisateur(1);
      expect(c.champs_total).toBe(12);
      expect(c.manquants.map((m) => m.champ)).not.toContain('pseudo');
    });
  });

  describe('conformité', () => {
    it('déclare tout le monde conforme tant que le seuil est inactif', async () => {
      config({ est_actif: false });
      const c = await service.pourUtilisateur(1);
      expect(c.pourcentage).toBe(19);
      // Le client n'a pas à connaître la règle d'activation pour choisir son écran.
      expect(c.conforme).toBe(true);
    });

    it('refuse un profil sous le seuil quand il est actif', async () => {
      config({ est_actif: true, seuil_completion: 95 });
      expect((await service.pourUtilisateur(1)).conforme).toBe(false);
    });

    it('accepte un profil complet au seuil de 95 %', async () => {
      config({ est_actif: true, seuil_completion: 95 });
      utilisateurs.findOne.mockResolvedValue(utilisateurComplet());
      expect((await service.pourUtilisateur(1)).conforme).toBe(true);
    });

    it('95 % est inatteignable sans 100 % avec 16 champs', async () => {
      // 15/16 = 93,75 % ; aucune valeur n'existe entre 93,75 et 100.
      config({ est_actif: true, seuil_completion: 95 });
      utilisateurs.findOne.mockResolvedValue({ ...utilisateurComplet(), verifier: false });
      const c = await service.pourUtilisateur(1);
      expect(c.pourcentage).toBe(94);
      expect(c.conforme).toBe(false);
    });

    it('ne calcule rien quand le seuil est inactif — court-circuit', async () => {
      config({ est_actif: false });
      const r = await service.estConforme(1);
      expect(r).toMatchObject({ conforme: true, actif: false });
      // Inutile de charger l'utilisateur pour une règle qui ne s'applique pas.
      expect(utilisateurs.findOne).not.toHaveBeenCalled();
    });
  });

  describe('valeurs par défaut', () => {
    it('se replie sur 95 % inactif sans configuration en base', async () => {
      configurations.findOne.mockResolvedValue(null);
      const c = await service.pourUtilisateur(1);
      expect(c).toMatchObject({ seuil_requis: 95, seuil_actif: false, conforme: true });
    });
  });
});
