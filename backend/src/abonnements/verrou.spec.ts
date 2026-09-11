import { VerrouService } from './verrou.service';

describe('VerrouService', () => {
  let configurations: any, config: any, service: VerrouService;

  const creer = (env: string | undefined, ligne: any = null) => {
    configurations = {
      findOne: jest.fn().mockResolvedValue(ligne),
      save: jest.fn(async (l) => l),
      create: jest.fn((l) => ({ ...l })),
    };
    config = { get: jest.fn().mockReturnValue(env) };
    return new VerrouService(configurations, config);
  };

  describe('valeur de repli', () => {
    it('lit la variable de déploiement quand la table est vide', async () => {
      service = creer('true');
      await service.onModuleInit();
      expect(service.estActif()).toBe(true);
    });

    it('reste éteint quand la variable est absente', async () => {
      service = creer(undefined);
      await service.onModuleInit();
      expect(service.estActif()).toBe(false);
    });

    it('ne prend pour vrai que la chaîne "true"', async () => {
      for (const v of ['TRUE', 'True']) {
        service = creer(v);
        await service.onModuleInit();
        expect(service.estActif()).toBe(true);
      }
      for (const v of ['1', 'oui', 'yes', '']) {
        service = creer(v);
        await service.onModuleInit();
        expect(service.estActif()).toBe(false);
      }
    });

    it('ne masque pas un true de déploiement par un faux enregistré', async () => {
      // Mémoriser `false` quand la table est vide ferait basculer, au premier
      // rafraîchissement, un environnement volontairement verrouillé.
      service = creer('true');
      await service.onModuleInit();
      expect(service.estActif()).toBe(true);
      expect(configurations.findOne).toHaveBeenCalled();
    });
  });

  describe('la base fait autorité', () => {
    it('un false enregistré éteint un true de déploiement', async () => {
      service = creer('true', { pays: 'benin', verrou_actif: false });
      await service.onModuleInit();
      expect(service.estActif()).toBe(false);
    });

    it('un true enregistré allume un déploiement éteint', async () => {
      service = creer('false', { pays: 'benin', verrou_actif: true });
      await service.onModuleInit();
      expect(service.estActif()).toBe(true);
    });
  });

  describe('lecture', () => {
    it('ne fait aucune requête sur le chemin chaud', async () => {
      service = creer('false', { pays: 'benin', verrou_actif: true });
      await service.onModuleInit();
      configurations.findOne.mockClear();
      // Le guard appelle ceci à chaque téléchargement : une requête SQL ici
      // dégraderait une latence déjà surveillée.
      for (let i = 0; i < 50; i++) service.estActif();
      expect(configurations.findOne).not.toHaveBeenCalled();
    });

    it('sert la valeur d’environnement avant tout chargement', () => {
      service = creer('true');
      expect(service.estActif()).toBe(true);
    });
  });

  describe('bascule', () => {
    it('prend effet immédiatement, sans attendre le rafraîchissement', async () => {
      service = creer('false');
      await service.onModuleInit();
      expect(service.estActif()).toBe(false);

      configurations.findOne.mockResolvedValue({ pays: 'benin', verrou_actif: true });
      await service.basculer('benin', true, 7);

      // Sans mise à jour immédiate du cache, l'administrateur croirait à une
      // panne pendant une demi-minute.
      expect(service.estActif()).toBe(true);
      expect(configurations.save).toHaveBeenCalledWith(
        expect.objectContaining({ verrou_actif: true, modifie_par: 7 }),
      );
    });

    it('crée la ligne à la première bascule', async () => {
      service = creer('false');
      await service.onModuleInit();
      configurations.findOne.mockResolvedValue(null);
      await service.basculer('benin', true, 7);
      expect(configurations.create).toHaveBeenCalledWith({ pays: 'benin' });
    });

    it('retient qui a actionné l’interrupteur', async () => {
      service = creer('false', { pays: 'benin', verrou_actif: false });
      await service.onModuleInit();
      await service.basculer('benin', true, 42);
      expect(configurations.save).toHaveBeenCalledWith(expect.objectContaining({ modifie_par: 42 }));
    });
  });

  describe('portée par pays', () => {
    it('n’applique pas le réglage du Bénin au Sénégal', async () => {
      service = creer('false');
      configurations.findOne.mockImplementation(async ({ where }: any) =>
        where.pays === 'benin' ? { pays: 'benin', verrou_actif: true } : null,
      );
      await service.onModuleInit();
      expect(service.estActif('benin')).toBe(true);
      // Le Sénégal n'a pas de ligne : il retombe sur l'environnement.
      expect(service.estActif('senegal')).toBe(false);
    });
  });

  describe('état pour le back-office', () => {
    it('dit que la valeur vient du déploiement quand rien n’est enregistré', async () => {
      service = creer('true');
      expect(await service.etat('benin')).toMatchObject({
        verrou_actif: true,
        origine: 'environnement',
        valeur_environnement: true,
      });
    });

    it('dit que la valeur vient d’une bascule, et laquelle', async () => {
      const date = new Date('2026-09-11T15:00:00Z');
      service = creer('false', { pays: 'benin', verrou_actif: true, modifie_par: 16, date_modification: date });
      expect(await service.etat('benin')).toEqual({
        verrou_actif: true,
        origine: 'base',
        valeur_environnement: false,
        date_modification: date,
        modifie_par: 16,
      });
    });
  });
});
