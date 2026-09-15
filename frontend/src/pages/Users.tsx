import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, Loader2, Trash2, ChevronLeft, ChevronRight, ArrowUpDown, Eye } from "lucide-react";
import { usersService } from "@/lib/services/users.service";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCountryTimezone } from "@/hooks/useCountryTimezone";

// date_creation est stocké en UTC ; on l'affiche (date + heure) dans le fuseau du
// PAYS sélectionné (ex. Benin → Africa/Cotonou), fourni par la config backend.
const fmtDateTime = (v?: string | null, timeZone?: string) =>
  v ? new Date(v).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }) : "-";

function Field({ label, value }: { label: string; value?: unknown }) {
  const display = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium break-words">{display}</p>
    </div>
  );
}

export default function Users() {
  const navigate = useNavigate();
  const [detailsUser, setDetailsUser] = useState<any | null>(null);
  const timeZone = useCountryTimezone();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedActivated, setSelectedActivated] = useState<string | null>("ALL");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10); // Default limit
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const [newUser, setNewUser] = useState({
    nom: "",
    prenom: "",
    email: "",
    mot_de_passe: "",
    role: "étudiant",
    sexe: "M",
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: usersResponse, isLoading, error } = useQuery({
    queryKey: ['users', debouncedSearchQuery, selectedRole, selectedActivated, page, limit, sortOrder],
    queryFn: () => usersService.getAll({
      search: debouncedSearchQuery || undefined,
      role: selectedRole || undefined,
      activated: selectedActivated === "ALL" ? undefined : selectedActivated === "true",
      page,
      limit,
      sort_by: 'date_creation',
      sort_order: sortOrder
    }),
  });
  const users = usersResponse?.data || [];
  const totalPages = usersResponse?.totalPages || 1;

  const createMutation = useMutation({
    mutationFn: (data: any) => usersService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setIsCreateOpen(false);
      setNewUser({
        nom: "",
        prenom: "",
        email: "",
        mot_de_passe: "",
        role: "étudiant",
        sexe: "M",
      });
      toast({
        title: "Succès",
        description: "Utilisateur créé avec succès",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: error.message || "Échec de la création",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersService.delete(parseInt(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteId(null);
      toast({
        title: "Succès",
        description: "Utilisateur supprimé avec succès",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: error.message || "Échec de la suppression",
        variant: "destructive",
      });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(newUser);
  };

  const toggleSortOrder = () => {
    setSortOrder(current => current === 'ASC' ? 'DESC' : 'ASC');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Utilisateurs</h1>
          <p className="text-muted-foreground">Gérer les utilisateurs de la plateforme</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Nouvel utilisateur
        </Button>
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Liste des utilisateurs</CardTitle>
          <CardDescription>
            <div className="flex flex-col md:flex-row gap-4 mt-4 items-center">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Rechercher par nom ou email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={selectedRole || "ALL"}
                onValueChange={(value) => setSelectedRole(value === "ALL" ? null : value)}
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Filtrer par rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tous les rôles</SelectItem>
                  <SelectItem value="étudiant">Étudiant</SelectItem>
                  <SelectItem value="professeur">Professeur</SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={selectedActivated || "ALL"}
                onValueChange={(value) => setSelectedActivated(value)}
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Filtrer par statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tous les statuts</SelectItem>
                  <SelectItem value="true">Actifs</SelectItem>
                  <SelectItem value="false">Supprimés</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleSortOrder}
                title={`Trier par date (${sortOrder === 'ASC' ? 'Croissant' : 'Décroissant'})`}
              >
                <ArrowUpDown className={`h-4 w-4 ${sortOrder === 'ASC' ? 'rotate-180' : ''} transition-transform`} />
              </Button>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              Erreur lors du chargement des utilisateurs
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Pays</TableHead>
                    <TableHead>Actif</TableHead>
                    <TableHead>Date création</TableHead>
                    <TableHead>Suppression définitive</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        Aucun utilisateur trouvé
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          {user.prenom} {user.nom}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{user.email}</TableCell>
                        <TableCell>
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {user.pays || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.est_desactive ? "destructive" : "outline"}>
                            {user.est_desactive ? "Non" : "Oui"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {fmtDateTime(user.date_creation, timeZone)}
                        </TableCell>
                        <TableCell>
                          {user.date_suppression_prevue
                            ? new Date(user.date_suppression_prevue).toLocaleDateString()
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {user.role === "admin" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/users/${user.id}/permissions`)}
                              >
                                Permissions
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDetailsUser(user)}
                              title="Voir les détails"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteId(user.id)}
                              className="text-destructive hover:text-destructive/90"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {/* Pagination mirrored from Etablissements.tsx */}
              {usersResponse?.totalPages !== undefined && usersResponse.totalPages > 1 && (
                <div className="flex items-center justify-center space-x-2 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    Page {page} sur {usersResponse.totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(usersResponse.totalPages, p + 1))}
                    disabled={page === usersResponse.totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer cet utilisateur ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId.toString())}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Suppression...
                </>
              ) : (
                "Supprimer"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={detailsUser !== null} onOpenChange={(open) => !open && setDetailsUser(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailsUser?.prenom} {detailsUser?.nom}</DialogTitle>
            <DialogDescription>{detailsUser?.email}</DialogDescription>
          </DialogHeader>
          {detailsUser && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label="Rôle" value={detailsUser.role} />
              <Field label="Pseudo" value={detailsUser.pseudo} />
              <Field label="Téléphone" value={detailsUser.telephone} />
              <Field label="Sexe" value={detailsUser.sexe} />
              <Field label="Pays" value={detailsUser.pays} />
              <Field label="Tranche d'âge" value={detailsUser.age_group} />
              <Field label="Zone de résidence" value={detailsUser.zone_residence} />
              <Field label="Situation handicap" value={detailsUser.situation_handicap ? "Oui" : "Non"} />
              <Field label="Département" value={detailsUser.departement?.nom} />
              <Field label="Ville" value={detailsUser.ville?.nom} />
              <Field label="Établissement" value={detailsUser.etablissement?.nom} />
              <Field label="Filière" value={detailsUser.filiere?.nom} />
              <Field label="Niveau d'étude" value={detailsUser.niveau_etude?.nom} />
              <Field label="Type de profil" value={detailsUser.type_profil ? `${detailsUser.type_profil.icone ?? ""} ${detailsUser.type_profil.titre}`.trim() : null} />
              <Field label="Son code parrainage" value={detailsUser.mon_code_parrainage} />
              <Field label="Code parrainage saisi" value={detailsUser.code_parrainage_saisi} />
              <Field label="Email vérifié" value={detailsUser.isEmailVerified ? "Oui" : "Non"} />
              <Field label="Prestataire" value={detailsUser.isPrestataire ? "Oui" : "Non"} />
              <Field label="Recruteur" value={detailsUser.isRecruteur ? "Oui" : "Non"} />
              <Field label="Actif" value={detailsUser.est_desactive ? "Non" : "Oui"} />
              <Field label="Créé le" value={fmtDateTime(detailsUser.date_creation, timeZone)} />
              <Field label="Suppression prévue" value={detailsUser.date_suppression_prevue ? fmtDateTime(detailsUser.date_suppression_prevue, timeZone) : "—"} />
              <div className="col-span-2"><Field label="UUID" value={detailsUser.uuid} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsUser(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvel utilisateur</DialogTitle>
            <DialogDescription>
              Créez un nouvel utilisateur en remplissant les champs ci-dessous.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prenom">Prénom</Label>
                <Input
                  id="prenom"
                  value={newUser.prenom}
                  onChange={(e) => setNewUser({ ...newUser, prenom: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nom">Nom</Label>
                <Input
                  id="nom"
                  value={newUser.nom}
                  onChange={(e) => setNewUser({ ...newUser, nom: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={newUser.mot_de_passe}
                onChange={(e) => setNewUser({ ...newUser, mot_de_passe: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="role">Rôle</Label>
                <Select
                  value={newUser.role}
                  onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un rôle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="étudiant">Étudiant</SelectItem>
                    <SelectItem value="professeur">Professeur</SelectItem>
                    <SelectItem value="admin">Administrateur</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sexe">Sexe</Label>
                <Select
                  value={newUser.sexe}
                  onValueChange={(value) => setNewUser({ ...newUser, sexe: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner le sexe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Masculin</SelectItem>
                    <SelectItem value="F">Féminin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Création...
                  </>
                ) : (
                  "Créer"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div >
  );
}
