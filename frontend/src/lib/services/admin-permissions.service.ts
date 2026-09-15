import { api } from '@/lib/api';

export const ADMIN_PERMISSIONS = [
  ['admin.users', 'Utilisateurs'],
  ['admin.payments', 'Paiements'],
  ['admin.withdrawals', 'Retraits'],
  ['admin.subscriptions', 'Abonnements'],
  ['admin.content', 'Contenus'],
  ['admin.education', 'Éducation'],
  ['admin.analytics', 'Statistiques'],
  ['admin.settings', 'Paramètres'],
] as const;

export const adminPermissionsService = {
  get: (id: string) => api.get<{ permissions: string[] | null }>(`/utilisateurs/${id}/admin-permissions`),
  update: (id: string, permissions: string[]) => api.patch(`/utilisateurs/${id}/admin-permissions`, { permissions }),
};
