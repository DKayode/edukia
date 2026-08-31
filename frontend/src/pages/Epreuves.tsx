import { useState, useEffect } from "react";
import { type EpreuveType, type EpreuveSection } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, FileText, Trash2, Search, Loader2, Eye, ChevronLeft, ChevronRight, Pencil, Check, ChevronsUpDown, ScanText } from "lucide-react";
import { TranscriptionReviewDialog } from "@/components/TranscriptionReviewDialog";
import { cn, getAcronym } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { epreuvesService } from "@/lib/services/epreuves.service";
import { filieresService } from "@/lib/services/filieres.service";
import { matieresService } from "@/lib/services/matieres.service";
import { niveauxService } from "@/lib/services/niveaux.service";
import { etablissementsService } from "@/lib/services/etablissements.service";
import { fichiersService } from "@/lib/services/fichiers.service";
import { filesService } from "@/lib/services/files.service";

export default function Epreuves() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [selectedType, setSelectedType] = useState<EpreuveType | "ALL">("ALL");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Cascading Select State
  const [selectedEtablissement, setSelectedEtablissement] = useState<string>("");
  const [selectedFiliere, setSelectedFiliere] = useState<string>("");
  const [selectedNiveau, setSelectedNiveau] = useState<string>("");

  // Edit mode state
  const [editData, setEditData] = useState<any | null>(null);

  const [formData, setFormData] = useState({
    titre: "",
    type: "Examens" as EpreuveType, // épreuve upload toujours de type Examens
    duree_minutes: "",
    nombre_pages: "",
    matiere_id: "",
    date_publication: "",
    annee: "",
    section: "normal" as EpreuveSection,
  });

  const queryClient = useQueryClient();

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  // Relecture de ce que Kessiah lit de l'épreuve (transcription automatique).
  const [reviewEpreuve, setReviewEpreuve] = useState<{ id: number | string; titre: string } | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const { data: epreuvesResponse, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['epreuves', page, limit, debouncedSearchQuery, selectedType],
    queryFn: () => epreuvesService.getAll({
      page,
      limit,
      search: debouncedSearchQuery || undefined, // Send as undefined if empty
      type: selectedType === "ALL" ? undefined : selectedType
    }),
    placeholderData: keepPreviousData,
  });
  const epreuves = epreuvesResponse?.data || [];

  // Cascading Queries
  const { data: etablissementsResponse } = useQuery({
    queryKey: ['etablissements_all'],
    queryFn: () => etablissementsService.getAll({ page: 1, limit: 1000 }),
  });
  const etablissements = etablissementsResponse?.data || [];

  const { data: filieresResponse } = useQuery({
    queryKey: ['filieres', selectedEtablissement],
    queryFn: () => etablissementsService.getFilieres(selectedEtablissement, {
      page: 1,
      limit: 1000
    }),
    enabled: !!selectedEtablissement,
  });
  const filieres = filieresResponse?.data || [];

  const { data: niveauxResponse } = useQuery({
    queryKey: ['niveaux', selectedEtablissement, selectedFiliere],
    queryFn: () => etablissementsService.getNiveaux(selectedEtablissement, selectedFiliere, {
      page: 1,
      limit: 1000
    }),
    enabled: !!selectedEtablissement && !!selectedFiliere,
  });
  const niveaux = niveauxResponse?.data || [];

  const { data: matieresResponse } = useQuery({
    queryKey: ['matieres', selectedEtablissement, selectedFiliere, selectedNiveau],
    queryFn: () => etablissementsService.getMatieres(selectedEtablissement, selectedFiliere, selectedNiveau, {
      page: 1,
      limit: 1000
    }),
    enabled: !!selectedEtablissement && !!selectedFiliere && !!selectedNiveau,
  });
  const matieres = matieresResponse?.data || [];

  // Titre auto-construit à partir de (matière + section + année) — même règle que le backend.
  useEffect(() => {
    const matiereNom = matieres.find((m) => m.id?.toString() === formData.matiere_id)?.nom;
    if (!matiereNom) return; // sans le nom de la matière, on garde le titre existant
    const titre = [matiereNom, formData.section, formData.annee]
      .map((p) => String(p ?? "").trim())
      .filter((p) => p !== "")
      .join(" — ");
    setFormData((prev) => (prev.titre === titre ? prev : { ...prev, titre }));
  }, [formData.matiere_id, formData.section, formData.annee, matieres]);

  const createMutation = useMutation({
    mutationFn: async (data: { file: File; titre: string; type?: string; duree_minutes: number; nombre_pages?: number; matiere_id: number; date_publication?: string; annee?: number; section?: EpreuveSection }) => {
      // 1. Create the epreuve row — backend assigns the uuid we use as
      //    the R2 key on the next step. Metadata that the legacy
      //    /fichiers/epreuve endpoint accepted as form fields is set
      //    via a follow-up update.
      const created = await epreuvesService.create({
        titre: data.titre,
        matiere_id: data.matiere_id,
      });
      await epreuvesService.update(created.id.toString(), {
        type: data.type,
        duree_minutes: data.duree_minutes,
        nombre_pages: data.nombre_pages,
        date_publication: data.date_publication,
        annee: data.annee,
        section: data.section,
      });

      // 2. PUT bytes to R2 via presigned URL.
      if (created.uuid) {
        await filesService.uploadFile('epreuves', created.uuid, 'file', data.file);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['epreuves'] });
      toast.success("Épreuve créée avec succès");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Erreur lors de la création");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; titre: string; type?: string; duree_minutes: number; nombre_pages?: number; matiere_id: number; date_publication?: string; annee?: number; section?: EpreuveSection }) =>
      epreuvesService.update(data.id, {
        titre: data.titre,
        type: data.type,
        duree_minutes: data.duree_minutes,
        nombre_pages: data.nombre_pages,
        matiere_id: data.matiere_id,
        date_publication: data.date_publication,
        annee: data.annee,
        section: data.section,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['epreuves'] });
      toast.success("Épreuve mise à jour avec succès");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Erreur lors de la mise à jour");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => epreuvesService.delete(id.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['epreuves'] });
      toast.success("Épreuve supprimée avec succès");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erreur lors de la suppression");
    },
  });

  const resetForm = () => {
    setFormData({
      titre: "",
      type: "Examens",
      duree_minutes: "",
      nombre_pages: "",
      matiere_id: "",
      date_publication: "",
      annee: "",
      section: "normal",
    });
    setSelectedFile(null);
    setEditData(null);
    setSelectedEtablissement("");
    setSelectedFiliere("");
    setSelectedNiveau("");
  };

  const handleOpenDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleEdit = (epreuve: any) => {
    setEditData(epreuve);

    // Set cascading state
    const matiere = epreuve.matiere;
    if (matiere) {
      const niveau = matiere.niveau_etude;
      if (niveau) {
        setSelectedNiveau(niveau.id.toString());
        const filiere = niveau.filiere;
        if (filiere) {
          setSelectedFiliere(filiere.id.toString());
          const etablissement = filiere.etablissement;
          if (etablissement) {
            setSelectedEtablissement(etablissement.id.toString());
          }
        }
      }
    }

    setFormData({
      titre: epreuve.titre,
      // Seuls Examens / Examens Nationaux sont sélectionnables — tout ancien type retombe sur Examens.
      type: "Examens",   // seule valeur écrivable ; les examens nationaux ont leur ressource
      duree_minutes: epreuve.duree_minutes?.toString() || "",
      nombre_pages: epreuve.nombre_pages?.toString() || "",
      matiere_id: (epreuve.matiere_id || epreuve.matiere?.id)?.toString() || "",
      date_publication: epreuve.date_publication ? new Date(epreuve.date_publication).toISOString().slice(0, 16) : "",
      annee: epreuve.annee?.toString() || "",
      section: epreuve.section || "normal",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.titre || !formData.matiere_id || (!selectedFile && !editData) || !formData.type) {
      toast.error(editData ? "Veuillez remplir tous les champs requis (Titre, Type, Matière)" : "Veuillez remplir tous les champs requis (Titre, Type, Matière, Fichier)");
      return;
    }

    if (editData) {
      updateMutation.mutate({
        id: editData.id.toString(),
        titre: formData.titre,
        type: formData.type || undefined,
        duree_minutes: formData.duree_minutes ? parseInt(formData.duree_minutes, 10) : 0,
        nombre_pages: formData.nombre_pages ? parseInt(formData.nombre_pages, 10) : undefined,
        matiere_id: parseInt(formData.matiere_id, 10),
        date_publication: formData.date_publication || undefined,
        annee: formData.annee ? parseInt(formData.annee, 10) : undefined,
        section: formData.section,
      });
    } else {
      // Create mode - Requires File
      if (!selectedFile) return;

      createMutation.mutate({
        file: selectedFile,
        titre: formData.titre,
        type: formData.type || undefined,
        duree_minutes: formData.duree_minutes ? parseInt(formData.duree_minutes, 10) : 0,
        nombre_pages: formData.nombre_pages ? parseInt(formData.nombre_pages, 10) : undefined,
        matiere_id: parseInt(formData.matiere_id, 10),
        date_publication: formData.date_publication || undefined,
        annee: formData.annee ? parseInt(formData.annee, 10) : undefined,
        section: formData.section,
      });
    }
  };

  const handlePreview = async (epreuve: any) => {
    try {
      const blob = await epreuvesService.download(epreuve.id);
      const url = window.URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewTitle(epreuve.titre);
      setIsPreviewOpen(true);
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Erreur lors du chargement de l'aperçu");
    }
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  // Client-side filtering removed in favor of backend filtering
  const filteredEpreuves = epreuves;

  if (isLoading && !isPlaceholderData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-destructive">Erreur lors du chargement des épreuves</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Épreuves</h1>
          <p className="text-muted-foreground">Gérer les épreuves d'examens</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={handleOpenDialog}>
              <Upload className="h-4 w-4" />
              Nouvelle épreuve
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{editData ? "Modifier l'épreuve" : "Créer une épreuve"}</DialogTitle>
              <DialogDescription>
                {editData ? "Modifier les informations de l'épreuve" : "Ajoutez une nouvelle épreuve d'examen au système"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="space-y-2">
                <Label htmlFor="titre">Titre de l'épreuve (auto)</Label>
                <Input
                  id="titre"
                  placeholder="Généré depuis matière + section + année"
                  value={formData.titre}
                  readOnly
                  className="bg-muted text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Construit automatiquement : matière — section — année.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="type">Type d'épreuve *</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => setFormData({ ...formData, type: value as EpreuveType })}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Choisir le type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Examens">Examens</SelectItem>

                    </SelectContent>
                  </Select>
                </div>

                {!editData && (
                  <div className="space-y-2">
                    <Label htmlFor="file">Fichier de l'épreuve *</Label>
                    <Input
                      id="file"
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    />
                    {selectedFile && (
                      <p className="text-sm text-muted-foreground truncate">
                        {selectedFile.name}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="duree">Durée (minutes)</Label>
                  <Input
                    id="duree"
                    type="number"
                    placeholder="120"
                    value={formData.duree_minutes}
                    onChange={(e) => setFormData({ ...formData, duree_minutes: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pages">Nombre de pages</Label>
                  <Input
                    id="pages"
                    type="number"
                    placeholder="Ex: 5"
                    value={formData.nombre_pages}
                    onChange={(e) => setFormData({ ...formData, nombre_pages: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="annee">Année</Label>
                  <Input
                    id="annee"
                    type="number"
                    placeholder="Ex: 2023"
                    value={formData.annee}
                    onChange={(e) => setFormData({ ...formData, annee: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="section">Session</Label>
                  <Select
                    value={formData.section}
                    onValueChange={(value) => setFormData({ ...formData, section: value as EpreuveSection })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner la session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="rattrapage">Rattrapage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="etablissement">Etablissement *</Label>
                  <Select
                    value={selectedEtablissement}
                    onValueChange={(value) => {
                      setSelectedEtablissement(value);
                      setSelectedFiliere("");
                      setSelectedNiveau("");
                      setFormData(prev => ({ ...prev, matiere_id: "" }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      {etablissements.map((etablissement) => (
                        <SelectItem key={etablissement.id} value={etablissement.id.toString()}>
                          {etablissement.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="filiere">Filière *</Label>
                  <Select
                    value={selectedFiliere}
                    onValueChange={(value) => {
                      setSelectedFiliere(value);
                      setSelectedNiveau("");
                      setFormData(prev => ({ ...prev, matiere_id: "" }));
                    }}
                    disabled={!selectedEtablissement}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      {filieres.map((filiere) => (
                        <SelectItem key={filiere.id} value={filiere.id.toString()}>
                          {filiere.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="niveau">Niveau d'étude *</Label>
                  <Select
                    value={selectedNiveau}
                    onValueChange={(value) => {
                      setSelectedNiveau(value);
                      setFormData(prev => ({ ...prev, matiere_id: "" }));
                    }}
                    disabled={!selectedFiliere}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      {niveaux.map((niveau) => (
                        <SelectItem key={niveau.id} value={niveau.id.toString()}>
                          {niveau.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="matiere">Matière *</Label>
                  <Select
                    value={formData.matiere_id}
                    onValueChange={(value) => setFormData({ ...formData, matiere_id: value })}
                    disabled={!selectedNiveau}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      {matieres.map((matiere) => (
                        <SelectItem key={matiere.id} value={matiere.id.toString()}>
                          {matiere.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Date de publication (optionnel)</Label>
                <Input
                  id="date"
                  type="datetime-local"
                  value={formData.date_publication}
                  onChange={(e) => setFormData({ ...formData, date_publication: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Si vide, l'épreuve sera publiée immédiatement
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editData ? (updateMutation.isPending ? "Modification..." : "Modifier") : (createMutation.isPending ? "Création..." : "Créer")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Liste des épreuves ({epreuves.length})</CardTitle>
          <CardDescription>
            <div className="flex flex-col md:flex-row gap-4 mt-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Rechercher par titre ou matière..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={selectedType}
                onValueChange={(value) => setSelectedType(value as EpreuveType | "ALL")}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Type d'épreuve" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tous les types</SelectItem>
                  {/* Types historiques : filtrables (1 304 épreuves sont « Devoirs »)
                      mais plus écrivables. « Examens Nationaux » a disparu : ces
                      contenus ont leur propre ressource, aucune épreuve n'en porte. */}
                  <SelectItem value="Interrogation">Interrogation</SelectItem>
                  <SelectItem value="Devoirs">Devoirs</SelectItem>
                  <SelectItem value="Concours">Concours</SelectItem>
                  <SelectItem value="Examens">Examens</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredEpreuves.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                {searchQuery ? "Aucune épreuve trouvée" : "Aucune épreuve disponible"}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titre</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Matière</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Téléch.</TableHead>
                    <TableHead>Durée</TableHead>
                    <TableHead>Date création</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEpreuves.map((epreuve) => (
                    <TableRow key={epreuve.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {epreuve.titre}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{epreuve.type || "Autre"}</Badge>
                      </TableCell>
                      <TableCell>{epreuve.matiere?.nom || "-"}</TableCell>
                      <TableCell>{epreuve.nombre_pages || "-"}</TableCell>
                      <TableCell>{epreuve.nombre_telechargements || 0}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{epreuve.duree_minutes} min</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(epreuve.date_creation).toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-orange-500 hover:text-orange-600"
                            onClick={() => handleEdit(epreuve)}
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!epreuve.url}
                            className="h-8 w-8 text-blue-500 hover:text-blue-600"
                            onClick={() => handlePreview(epreuve)}
                            title="Visualiser"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-emerald-600 hover:text-emerald-700"
                            onClick={() => setReviewEpreuve({ id: epreuve.id, titre: epreuve.titre })}
                            title="Relire la transcription lue par Ketsia"
                          >
                            <ScanText className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(epreuve.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {epreuvesResponse?.totalPages !== undefined && epreuvesResponse.totalPages > 1 && (
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
                    Page {page} sur {epreuvesResponse.totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(epreuvesResponse.totalPages, p + 1))}
                    disabled={page === epreuvesResponse.totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
            <DialogDescription>
              Aperçu du fichier
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 h-full min-h-[60vh] w-full rounded-md border bg-muted/50">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                className="w-full h-full rounded-md"
                title="Aperçu du fichier"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TranscriptionReviewDialog
        target={reviewEpreuve ? { kind: "epreuve", id: reviewEpreuve.id } : null}
        titre={reviewEpreuve?.titre}
        open={reviewEpreuve !== null}
        onOpenChange={(open) => !open && setReviewEpreuve(null)}
      />
    </div >
  );
}
