import { SetMetadata } from '@nestjs/common';
import { AdminPermission } from '../../utilisateurs/entities/utilisateur.entity';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: AdminPermission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
