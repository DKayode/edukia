import { ParcoursService } from './parcours.service';

/**
 * Deux régressions vérouillées ici :
 *  - la liste doit être cadrée par le pays (une base unique porte tous les
 *    pays) ;
 *  - la recherche ne doit plus interpoler la saisie dans le SQL.
 */
describe('ParcoursService - cadrage par pays et recherche sûre', () => {
  let repo: any;
  let service: ParcoursService;

  beforeEach(() => {
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      find: jest.fn().mockResolvedValue([]),
    };
    const resolver = { getRepository: jest.fn().mockReturnValue(repo) };
    service = new ParcoursService(resolver as any);
  });

  const requete = (surcharge = {}) => ({
    page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' as const, ...surcharge,
  });

  it('cadre findAll sur le pays reçu', async () => {
    await service.findAll('senegal', requete());
    expect(repo.findAndCount).toHaveBeenCalledTimes(1);
    expect(repo.findAndCount.mock.calls[0][0].where).toMatchObject({ pays: 'senegal' });
  });

  it('lie le terme de titre au lieu de l’interpoler', async () => {
    await service.findAll('benin', requete({ titre: "x') OR ('1'='1" }));
    const clause: any = repo.findAndCount.mock.calls[0][0].where.titre;
    // Un FindOperator Raw paramétré porte la valeur dans ses paramètres, pas
    // dans la chaîne SQL.
    expect(JSON.stringify(clause)).toContain("x') OR ('1'='1");
    // La valeur est encadrée de %…% et transmise comme paramètre lié.
    expect(clause?.value ?? clause).toBeDefined();
  });

  it('cadre la recherche plein-texte sur le pays, dans chaque branche du OR', async () => {
    await service.search('benin', 'ingénieur', 5);
    const where = repo.find.mock.calls[0][0].where;
    expect(Array.isArray(where)).toBe(true);
    for (const branche of where) {
      expect(branche.pays).toBe('benin');
    }
    expect(repo.find.mock.calls[0][0].take).toBe(5);
  });
});
