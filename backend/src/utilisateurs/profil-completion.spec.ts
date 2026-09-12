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
    configurations = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn(async (c) => c),
    };
    dataSource = { query: jest.fn().mockResolvedValue([{ total: 0 }]) };
    service = new ProfilCompletionService(utilisateurs, configurations, dataSource);
  });

  describe('champs comptés', () => {
    it('exclut situation_handicap', () => {
      // Sa colonne porte DEFAULT false : jamais vide, elle vaudrait un point
      // acquis d'avance pour tout le monde et n'apprendrait rien.
      expect(CHAMPS_PROFIL.map((c) => c.champ)).not.toContain('situation_handicap');
    });

    it('ne compte pas l’adresse email à part de sa vérification', () => {
      // Sans adresse il n'y a pas de compte : la compter créditerait tout le
      // monde d'un point acquis d'avance. Seule la vérification distingue.
      const champs = CHAMPS_PROFIL.map((c) => c.champ);
      expect(champs).not.toContain('email');
      expect(champs).toContain('email_verifie');
    });

    it('en compte quinze', () => {
      expect(CHAMPS_PROFIL).toHaveLength(15);
    });
  });

  describe('taux de remplissage par champ', () => {
    it('rapporte, pour chaque champ, combien de comptes l’ont rempli', async () => {
      const colonnes: any = { total: 200 };
      CHAMPS_PROFIL.forEach((_, i) => (colonnes[`c${i}`] = i === 0 ? 200 : 10));
      dataSource.query.mockResolvedValue([colonnes]);

      const taux = await service.tauxParChamp('benin');
      expect(taux[0]).toMatchObject({ champ: 'nom', remplis: 200, part: 100 });
      expect(taux[1]).toMatchObject({ remplis: 10, part: 5 });
    });

    it('ne divise pas par zéro sur une base vide', async () => {
      dataSource.query.mockResolvedValue([{ total: 0 }]);
      const taux = await service.tauxParChamp('benin');
      expect(taux.every((t) => t.part === 0)).toBe(true);
    });

    it('interroge la base une seule fois pour tous les champs', async () => {
      const colonnes: any = { total: 10 };
      CHAMPS_PROFIL.forEach((_, i) => (colonnes[`c${i}`] = 1));
      dataSource.query.mockResolvedValue([colonnes]);
      await service.tauxParChamp('benin');
      // Seize requêtes pour seize champs seraient seize allers-retours inutiles.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('accompagne les champs proposés au réglage', async () => {
      const colonnes: any = { total: 100 };
      CHAMPS_PROFIL.forEach((_, i) => (colonnes[`c${i}`] = 50));
      dataSource.query.mockResolvedValue([colonnes]);
      config();
      const r = await service.reglages('benin');
      // Sans ce chiffre, exclure un champ se ferait à l'aveugle.
      expect(r.champs_disponibles[0]).toMatchObject({ part: 50, remplis: 50 });
    });

    it('donne un libellé lisible à chaque champ', () => {
      // La liste `manquants` est destinée à l'utilisateur : un nom de colonne
      // n'y a pas sa place.
      expect(CHAMPS_PROFIL.every((c) => c.libelle && c.libelle !== c.champ)).toBe(true);
    });
  });

  describe('calcul', () => {
    it('compte 20 % pour un compte fraîchement inscrit', async () => {
      config();
      const c = await service.pourUtilisateur(1);
      // nom, prénom, sexe — l'adresse email ne compte plus pour elle-même.
      expect(c).toMatchObject({ champs_total: 15, champs_remplis: 3, pourcentage: 20 });
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
      expect(c.manquants).toHaveLength(12);
      expect(c.manquants).toContainEqual({ champ: 'telephone', libelle: 'Numéro de téléphone' });
    });

    it('ne réclame jamais la situation de handicap', async () => {
      config();
      const c = await service.pourUtilisateur(1);
      expect(c.manquants.map((m) => m.champ)).not.toContain('situation_handicap');
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
      expect(c.champs_total).toBe(11);
      expect(c.manquants.map((m) => m.champ)).not.toContain('pseudo');
    });
  });

  describe('conformité', () => {
    it('déclare tout le monde conforme tant que le seuil est inactif', async () => {
      config({ est_actif: false });
      const c = await service.pourUtilisateur(1);
      expect(c.pourcentage).toBe(20);
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

    it('95 % est inatteignable sans 100 % avec 15 champs', async () => {
      // 14/15 = 93,33 % ; aucune valeur n'existe entre 93 et 100.
      config({ est_actif: true, seuil_completion: 95 });
      utilisateurs.findOne.mockResolvedValue({ ...utilisateurComplet(), verifier: false });
      const c = await service.pourUtilisateur(1);
      expect(c.pourcentage).toBe(93);
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

  describe('pays sans configuration', () => {
    it('crée la ligne à la première écriture', async () => {
      // La migration n'en avait semé qu'une, pour le Bénin : régler le seuil
      // d'un autre pays répondait « Configuration de profil introuvable ».
      configurations.findOne.mockResolvedValue(null);
      // `modifierReglage` relit après écriture : le stub doit donc rendre la
      // ligne enregistrée, comme le ferait la base.
      configurations.save.mockImplementation(async (c: any) => {
        configurations.findOne.mockResolvedValue(c);
        return c;
      });
      const r = await service.modifierReglage('senegal', { seuil_completion: 80 });
      expect(configurations.create).toHaveBeenCalledWith(
        expect.objectContaining({ pays: 'senegal', est_actif: false }),
      );
      expect(configurations.save).toHaveBeenCalledWith(
        expect.objectContaining({ pays: 'senegal', seuil_completion: 80 }),
      );
      expect(r.seuil_completion).toBe(80);
    });

    it('ne crée rien quand la ligne existe', async () => {
      config({ est_actif: false });
      await service.modifierReglage('benin', { est_actif: true });
      expect(configurations.create).not.toHaveBeenCalled();
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
