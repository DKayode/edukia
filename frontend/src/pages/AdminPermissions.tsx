import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ADMIN_PERMISSIONS, adminPermissionsService } from '@/lib/services/admin-permissions.service';

export default function AdminPermissions() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const permissions = useQuery({ queryKey: ['admin-permissions', id], queryFn: () => adminPermissionsService.get(id), enabled: !!id });
  const [selected, setSelected] = useState<string[] | null>(null);
  const current = selected ?? permissions.data?.permissions ?? [];
  const update = useMutation({ mutationFn: () => adminPermissionsService.update(id, current), onSuccess: () => navigate('/users') });

  return <div className="p-6 max-w-2xl"><Card><CardHeader><CardTitle>Permissions administrateur</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Aucune permission signifie administrateur historique avec accès complet.</p>
    {ADMIN_PERMISSIONS.map(([value, label]) => <div key={value} className="flex items-center gap-3"><Checkbox checked={current.includes(value)} onCheckedChange={(checked) => setSelected(current.includes(value) === !!checked ? current : checked ? [...current, value] : current.filter((p) => p !== value))} /><Label>{label}</Label></div>)}
    <div className="flex gap-2 pt-4"><Button variant="outline" onClick={() => navigate('/users')}>Annuler</Button><Button onClick={() => update.mutate()} disabled={update.isPending || permissions.isLoading}>Enregistrer</Button></div>
  </CardContent></Card></div>;
}
