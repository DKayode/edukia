import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '../../utilisateurs/entities/utilisateur.entity';
import { permissionForPath } from './permission.guard';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>('roles', [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles) {
            return true;
        }

        const { user } = context.switchToHttp().getRequest();

        if (requiredRoles.some((role) => user?.role === role)) {
            if (user?.role === RoleType.ADMIN && user.permissions != null) {
                const inferred = permissionForPath(context.switchToHttp().getRequest().path ?? '');
                if (inferred && !user.permissions.includes(inferred) && !user.permissions.includes('*')) {
                    throw new ForbiddenException('Permission administrateur insuffisante.');
                }
            }
            return true;
        }

        throw new ForbiddenException("Vous n'avez pas les droits d'administrateur nécessaires pour effectuer cette action.");
    }
}
