import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaiementsController } from './paiements.controller';

describe('PaiementsController', () => {
  const service = {
    prestatairesDisponibles: jest.fn(),
  };
  const controller = new PaiementsController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it('expose la liste des prestataires sans authentification', async () => {
    const resultat = { pays: 'benin', prestataires: [] };
    service.prestatairesDisponibles.mockResolvedValue(resultat);

    await expect(controller.prestataires('benin')).resolves.toBe(resultat);
    expect(service.prestatairesDisponibles).toHaveBeenCalledWith('benin');

    const handler = PaiementsController.prototype.prestataires;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('prestataires');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
  });

  it.each(['initier', 'mesPaiements', 'findOne'] as const)('conserve JwtAuthGuard sur %s', (method) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PaiementsController.prototype[method]);
    expect(guards).toContain(JwtAuthGuard);
  });
});
