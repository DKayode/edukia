import { ForbiddenException } from '@nestjs/common';
import { PermissionGuard, permissionForPath } from './permission.guard';
import { AdminPermission } from '../../utilisateurs/entities/utilisateur.entity';

describe('PermissionGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as any;
  const guard = new PermissionGuard(reflector);

  const context = (permissions: AdminPermission[] | null, path = '/admin/paiements') => ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ path, user: { role: 'admin', permissions } }) }),
  }) as any;

  beforeEach(() => reflector.getAllAndOverride.mockReset());

  it('allows legacy super-admins with null permissions', () => {
    reflector.getAllAndOverride.mockReturnValue([AdminPermission.PAYMENTS]);
    expect(guard.canActivate(context(null))).toBe(true);
  });

  it('allows a matching permission', () => {
    reflector.getAllAndOverride.mockReturnValue([AdminPermission.PAYMENTS]);
    expect(guard.canActivate(context([AdminPermission.PAYMENTS]))).toBe(true);
  });

  it('rejects a non-matching permission', () => {
    reflector.getAllAndOverride.mockReturnValue([AdminPermission.PAYMENTS]);
    expect(() => guard.canActivate(context([AdminPermission.USERS]))).toThrow(ForbiddenException);
  });

  it('does not impose permissions on routes without metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(context([]))).toBe(true);
  });

  it('maps payment routes to payment permission', () => {
    expect(permissionForPath('/admin/paiements/configurations')).toBe(AdminPermission.PAYMENTS);
  });
});
