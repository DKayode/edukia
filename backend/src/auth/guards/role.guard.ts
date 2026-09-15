import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '../../utilisateurs/entities/utilisateur.entity';
import { permissionForPath } from './permission.guard';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<RoleType[]>('roles', context.getHandler());
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user.role)) return false;
    if (user.role === RoleType.ADMIN && user.permissions != null) {
      const inferred = permissionForPath(context.switchToHttp().getRequest().path ?? '');
      if (inferred && !user.permissions.includes(inferred) && !user.permissions.includes('*')) return false;
    }
    return true;
  }
}
