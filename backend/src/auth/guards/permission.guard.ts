import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AdminPermission } from '../../utilisateurs/entities/utilisateur.entity';

export function permissionForPath(path: string): AdminPermission | null {
  if (path.includes('/paiements') || path.includes('/payment')) return AdminPermission.PAYMENTS;
  if (path.includes('/withdrawals') || path.includes('/retraits')) return AdminPermission.WITHDRAWALS;
  if (path.includes('/abonnements') || path.includes('/codes')) return AdminPermission.SUBSCRIPTIONS;
  if (path.includes('/utilisateurs')) return AdminPermission.USERS;
  if (path.includes('/dashboard') || path.includes('/kpi') || path.includes('/statistiques') || path.includes('/indicateurs')) return AdminPermission.ANALYTICS;
  if (path.includes('/app/version') || path.includes('/configuration') || path.includes('/settings')) return AdminPermission.SETTINGS;
  if (path.includes('/etablissements') || path.includes('/filieres') || path.includes('/matieres') || path.includes('/niveau') || path.includes('/exam') || path.includes('/series') || path.includes('/titre') || path.includes('/structure') || path.includes('/departements') || path.includes('/villes')) return AdminPermission.EDUCATION;
  if (path.includes('/publicites') || path.includes('/evenements') || path.includes('/opportunites') || path.includes('/concours') || path.includes('/forum') || path.includes('/parcours') || path.includes('/categories') || path.includes('/services') || path.includes('/offres') || path.includes('/recruteurs') || path.includes('/competences') || path.includes('/kessiah')) return AdminPermission.CONTENT;
  return null;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminPermission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest().user;
    // Null means legacy super-admin: existing accounts are not locked out by the migration.
    if (user?.role === 'admin' && (user.permissions == null || user.permissions.includes('*'))) return true;
    const inferred = permissionForPath(context.switchToHttp().getRequest().path ?? '');
    if (user?.role === 'admin' && inferred && user.permissions?.includes(inferred)) return true;
    if (user?.role === 'admin' && required.some((permission) => user.permissions?.includes(permission))) return true;
    throw new ForbiddenException('Permission administrateur insuffisante.');
  }
}
