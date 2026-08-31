import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle, XCircle, ChevronLeft, ChevronRight, Wrench, AlertTriangle, Check, FileWarning, Plus, Eye , ScanText } from "lucide-react";
import { filesService } from "@/lib/services/files.service";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { TranscriptionReviewDialog } from '@/components/TranscriptionReviewDialog';
import { epreuveSubmissionsService, EpreuveSubmission, ResolveSubmissionData } from "@/lib/services/epreuve-submissions.service";
import { etablissementsService } from "@/lib/services/etablissements.service";
import { filieresService } from "@/lib/services/filieres.service";
import { niveauxService } from "@/lib/services/niveaux.service";
import { matieresService } from "@/lib/services/matieres.service";
import { SearchableSelect } from "@/components/SearchableSelect";

const getStatusBadgeVariant = (status?: string) => {
    switch (status) {
        case 'active':
        case 'approved': return 'default';
        case 'pending_approval': return 'secondary';
        case 'declined': return 'destructive';
        default: return 'secondary';
    }
};

const getStatusLabel = (status?: string) => {
    switch (status) {
        case 'approved': return 'Approuvée';
        case 'pending_approval': return 'En Attente';
        case 'declined': return 'Refusée';
        default: return status || '-';
    }
};

// One badge per parent level: the resolved name, or the proposed name flagged "à créer".
function ChainCell({ submission }: { submission: EpreuveSubmission }) {
    const levels: { resolved?: { nom: string } | null; proposed?: string | null; label: string }[] = [
        { resolved: submission.etablissement, proposed: submission.proposed_etablissement, label: 'Étab.' },
        { resolved: submission.filiere, proposed: submission.proposed_filiere, label: 'Filière' },
        { resolved: submission.niveau_etude, proposed: submission.proposed_niveau, label: 'Niveau' },
        { resolved: submission.matiere, proposed: submission.proposed_matiere, label: 'Matière' },
    ];
    return (
        <div className="flex flex-wrap gap-1">
            {levels.map((lvl, i) => lvl.resolved ? (
                <Badge key={i} variant="outline" className="font-normal">{lvl.resolved.nom}</Badge>
            ) : (
                <Badge key={i} variant="destructive" className="font-normal gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {lvl.proposed ? `à créer: ${lvl.proposed}` : `${lvl.label} manquant`}
                </Badge>
            ))}
        </div>
    );
}

// Per-level resolution: pick an existing entity OR create a new one (using the
// already-resolved parent id), then PATCH the submission with the chosen ids.
function ResolveDialog({ submission, open, onOpenChange }: {
    submission: EpreuveSubmission | null;
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [chosen, setChosen] = useState<ResolveSubmissionData>({});
    const [newNames, setNewNames] = useState<Record<string, string>>({});
    const [annee, setAnnee] = useState<string>('');
    const [section, setSection] = useState<string>('');
    const [type, setType] = useState<string>('');

    // Pre-fill type/année/session from the submission each time the dialog opens.
    useEffect(() => {
        if (open && submission) {
            setAnnee(submission.annee != null ? String(submission.annee) : '');
            setSection(submission.section ?? '');
            // Seuls Examens / Examens Nationaux — tout autre (ou null) retombe sur Examens.
            setType('Examens');   // l'épreuve créée est toujours « Examens »
        }
    }, [open, submission?.id]);

    // Effective parent ids drive the cascade: each level's option list is scoped
    // to the resolved parent above it (locally chosen, else already on the
    // submission). When a parent is unresolved — e.g. a brand-new établissement —
    // the child query is disabled, so its list is empty and the admin is forced
    // to create the child instead of picking an unrelated one.
    const eff = {
        etablissement_id: chosen.etablissement_id ?? submission?.etablissement?.id,
        filiere_id: chosen.filiere_id ?? submission?.filiere?.id,
        niveau_etude_id: chosen.niveau_etude_id ?? submission?.niveau_etude?.id,
        matiere_id: chosen.matiere_id ?? submission?.matiere?.id,
    };

    const lists = {
        etablissement: useQuery({ queryKey: ['etabs-all'], queryFn: () => etablissementsService.getAll({ limit: 200 }), enabled: open }),
        // all: true → don't hide filières/niveaux that have no épreuve yet; the
        // admin is attaching what may be the first épreuve under them.
        filiere: useQuery({
            queryKey: ['etab-filieres', eff.etablissement_id],
            queryFn: () => etablissementsService.getFilieres(String(eff.etablissement_id), { limit: 200, all: true }),
            enabled: open && !!eff.etablissement_id,
        }),
        niveau_etude: useQuery({
            queryKey: ['filiere-niveaux', eff.etablissement_id, eff.filiere_id],
            queryFn: () => etablissementsService.getNiveaux(String(eff.etablissement_id), String(eff.filiere_id), { limit: 200, all: true }),
            enabled: open && !!eff.etablissement_id && !!eff.filiere_id,
        }),
        // No all=true here: the matières endpoint has no épreuve-exists filter
        // and its DTO rejects the `all` prop (forbidNonWhitelisted → 400).
        matiere: useQuery({
            queryKey: ['niveau-matieres', eff.etablissement_id, eff.filiere_id, eff.niveau_etude_id],
            queryFn: () => etablissementsService.getMatieres(String(eff.etablissement_id), String(eff.filiere_id), String(eff.niveau_etude_id), { limit: 200 }),
            enabled: open && !!eff.etablissement_id && !!eff.filiere_id && !!eff.niveau_etude_id,
        }),
    };

    const reset = () => { setChosen({}); setNewNames({}); setAnnee(''); setSection(''); setType(''); };

    // Type/année/session are free fields (not auto-persisted like the parent
    // levels); this saves them on the submission. The titre is re-derived server-side.
    const saveAnneeSection = async () => {
        const patch: ResolveSubmissionData = {};
        if (annee.trim()) patch.annee = parseInt(annee);
        if (section) patch.section = section as 'normal' | 'rattrapage';
        if (type) patch.type = type as ResolveSubmissionData['type'];
        if (Object.keys(patch).length === 0) return;
        await persistMutation.mutateAsync(patch);
        toast({ title: 'Enregistré', description: 'Modifications enregistrées.' });
    };

    // Hooks must run before any early return — keep useMutation above the
    // `!submission` guard (this no-op-when-closed dialog toggles submission).
    // Each level persists to the submission the moment it's resolved (created or
    // picked), so there's no separate "save" step.
    const persistMutation = useMutation({
        mutationFn: (patch: ResolveSubmissionData) => epreuveSubmissionsService.resolve(submission!.id, patch),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
        },
        onError: (e: any) => toast({ title: "Erreur", description: e.message || "Échec du rattachement", variant: "destructive" }),
    });

    // Bind one level onto the submission immediately (local state drives the
    // in-dialog hierarchy; the PATCH persists it).
    // Descendants to clear locally when a level changes — picking a different
    // établissement invalidates any filière/niveau/matière chosen underneath it.
    const DESCENDANTS: Record<string, (keyof ResolveSubmissionData)[]> = {
        etablissement_id: ['filiere_id', 'niveau_etude_id', 'matiere_id'],
        filiere_id: ['niveau_etude_id', 'matiere_id'],
        niveau_etude_id: ['matiere_id'],
        matiere_id: [],
    };

    const resolveField = async (level: keyof ResolveSubmissionData, id: number) => {
        setChosen(c => {
            const next = { ...c, [level]: id };
            for (const child of DESCENDANTS[level]) delete next[child];
            return next;
        });
        await persistMutation.mutateAsync({ [level]: id });
    };

    if (!submission) return null;

    const allResolved = !!(eff.etablissement_id && eff.filiere_id && eff.niveau_etude_id && eff.matiere_id);

    // Base query key of each level's own option list — invalidated after a
    // create so the freshly-made entity shows up in that dropdown (its key is
    // unchanged, unlike child lists which refetch when their parent id changes).
    const LIST_KEY: Record<keyof ResolveSubmissionData, string> = {
        etablissement_id: 'etabs-all',
        filiere_id: 'etab-filieres',
        niveau_etude_id: 'filiere-niveaux',
        matiere_id: 'niveau-matieres',
        annee: '',
        section: '',
        type: '',
    };

    const createAndChoose = async (
        level: keyof ResolveSubmissionData,
        name: string,
        options: { id: number; nom: string }[],
        creator: () => Promise<{ id: number }>,
    ) => {
        try {
            // Reuse an existing entity of the same name (case-insensitive) instead
            // of minting a duplicate; only create when truly new.
            const trimmed = name.trim();
            const existing = options.find(o => o.nom.trim().toLowerCase() === trimmed.toLowerCase());
            const row = existing ?? await creator();
            // Refetch this level's list so the new entity appears in its dropdown.
            if (!existing && LIST_KEY[level]) await queryClient.invalidateQueries({ queryKey: [LIST_KEY[level]] });
            await resolveField(level, row.id);
            toast({
                title: existing ? "Rattaché" : "Créé et rattaché",
                description: existing ? "Entité existante réutilisée et rattachée." : "Entité créée et rattachée à la soumission.",
            });
        } catch (e: any) {
            toast({ title: "Erreur", description: e.message || "Échec de la création", variant: "destructive" });
        }
    };

    type LevelCfg = {
        key: keyof ResolveSubmissionData;
        label: string;
        resolvedName?: string;
        proposed?: string | null;
        options: { id: number; nom: string }[];
        canCreate: boolean;
        loading: boolean;
        create: (nom: string) => Promise<{ id: number }>;
    };

    const levels: LevelCfg[] = [
        {
            key: 'etablissement_id', label: 'Établissement',
            resolvedName: submission.etablissement?.nom, proposed: submission.proposed_etablissement,
            options: lists.etablissement.data?.data ?? [],
            canCreate: true,
            loading: lists.etablissement.isFetching,
            create: (nom) => etablissementsService.create({ nom }),
        },
        {
            key: 'filiere_id', label: 'Filière',
            resolvedName: submission.filiere?.nom, proposed: submission.proposed_filiere,
            options: lists.filiere.data?.data ?? [],
            canCreate: !!eff.etablissement_id,
            loading: lists.filiere.isFetching,
            create: (nom) => filieresService.create({ nom, etablissement_id: eff.etablissement_id! }),
        },
        {
            key: 'niveau_etude_id', label: "Niveau d'étude",
            resolvedName: submission.niveau_etude?.nom, proposed: submission.proposed_niveau,
            options: lists.niveau_etude.data?.data ?? [],
            canCreate: !!eff.filiere_id,
            loading: lists.niveau_etude.isFetching,
            create: (nom) => niveauxService.create({ nom, filiere_id: eff.filiere_id! }),
        },
        {
            key: 'matiere_id', label: 'Matière',
            resolvedName: submission.matiere?.nom, proposed: submission.proposed_matiere,
            options: lists.matiere.data?.data ?? [],
            canCreate: !!eff.niveau_etude_id,
            loading: lists.matiere.isFetching,
            create: (nom) => matieresService.create({
                nom,
                niveau_etude_id: eff.niveau_etude_id!,
                filiere_id: eff.filiere_id!,
            }),
        },
    ];

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Modifier la soumission — {submission.titre}</DialogTitle>
                    <DialogDescription>
                        Pour chaque niveau, sélectionnez une entité existante ou créez-la — y compris
                        pour changer un niveau déjà résolu. Chaque choix est enregistré automatiquement
                        sur la soumission. L'approbation sera possible une fois les quatre niveaux résolus.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {levels.map((lvl) => {
                        // Effective current id for this level (locally chosen, else
                        // what's already on the submission). Even a resolved level
                        // stays editable — the dropdown is pre-selected to it.
                        const currentId = (eff as Record<string, number | undefined>)[lvl.key];
                        const isResolved = !!currentId;

                        return (
                            <div key={lvl.key} className="rounded-lg border p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="font-semibold">{lvl.label}</Label>
                                    {isResolved ? (
                                        <Badge variant="default" className="gap-1"><Check className="h-3 w-3" /> Résolu</Badge>
                                    ) : (
                                        <Badge variant="destructive" className="gap-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {lvl.proposed ? `à créer: ${lvl.proposed}` : 'manquant'}
                                        </Badge>
                                    )}
                                </div>

                                <div className="space-y-2">
                                        <SearchableSelect
                                            value={currentId}
                                            options={lvl.options}
                                            onSelect={(id) => resolveField(lvl.key, id)}
                                            placeholder="Choisir une entité existante…"
                                            searchPlaceholder={`Rechercher une ${lvl.label.toLowerCase()}…`}
                                            emptyText={lvl.loading
                                                ? 'Chargement…'
                                                : !lvl.canCreate
                                                    ? 'Résolvez d\'abord le niveau parent'
                                                    : `Aucune ${lvl.label.toLowerCase()} pour cette sélection — créez-en une ci-dessous`}
                                        />

                                        <div className="flex items-center gap-2">
                                            <Input
                                                placeholder={lvl.proposed ? `Créer "${lvl.proposed}"…` : `Nom de la ${lvl.label.toLowerCase()}…`}
                                                value={newNames[lvl.key] ?? lvl.proposed ?? ''}
                                                onChange={(e) => setNewNames(n => ({ ...n, [lvl.key]: e.target.value }))}
                                            />
                                            <Button
                                                type="button"
                                                variant="default"
                                                className="shrink-0 gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                                                disabled={!lvl.canCreate || !(newNames[lvl.key] ?? lvl.proposed ?? '').trim()}
                                                title={lvl.canCreate ? 'Créer cette entité' : 'Résolvez d\'abord le niveau parent'}
                                                onClick={() => {
                                                    const name = (newNames[lvl.key] ?? lvl.proposed ?? '').trim();
                                                    createAndChoose(lvl.key, name, lvl.options, () => lvl.create(name));
                                                }}
                                            >
                                                <Plus className="h-4 w-4" />
                                                Créer
                                            </Button>
                                        </div>
                                    </div>
                            </div>
                        );
                    })}

                    <div className="rounded-lg border p-3 space-y-3">
                        <Label className="font-semibold">Type, année &amp; session</Label>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Type d'épreuve</Label>
                            <Select value={type || undefined} onValueChange={(v) => setType(v)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choisir le type…" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Examens">Examens</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Année</Label>
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    placeholder="ex. 2024"
                                    value={annee}
                                    onChange={(e) => setAnnee(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Session</Label>
                                <Select value={section || undefined} onValueChange={(v) => setSection(v)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Choisir…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="normal">Normale</SelectItem>
                                        <SelectItem value="rattrapage">Rattrapage</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        onClick={async () => { await saveAnneeSection(); reset(); onOpenChange(false); }}
                        disabled={persistMutation.isPending}
                    >
                        {persistMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Enregistrer les modifications
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function EpreuvesApprobation() {
    const [selectedStatus, setSelectedStatus] = useState<string>("pending_approval");
    const [selectedType, setSelectedType] = useState<string>("ALL");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [resolveTarget, setResolveTarget] = useState<EpreuveSubmission | null>(null);
    const [declineTarget, setDeclineTarget] = useState<EpreuveSubmission | null>(null);
    const [declineReason, setDeclineReason] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: response, isLoading, error } = useQuery({
        queryKey: ['admin-submissions', selectedStatus, selectedType, page, limit],
        queryFn: () => epreuveSubmissionsService.list({
            status: selectedStatus === "ALL" ? undefined : selectedStatus,
            type: selectedType === "ALL" ? undefined : (selectedType as EpreuveSubmission['type']),
            page,
            limit,
        }),
    });

    const submissions = response?.data || [];
    const totalPages = response?.totalPages || 1;

    // Relecture de ce que Kessiah lit du document soumis.
    const [reviewTarget, setReviewTarget] = useState<{ uuid: string; titre: string } | null>(null);

    const approveMutation = useMutation({
        mutationFn: (id: number) => epreuveSubmissionsService.approve(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['epreuves'] });
            toast({ title: "Soumission approuvée", description: "L'épreuve a été créée. L'auteur a été notifié par email." });
        },
        onError: (e: any) => toast({ title: "Erreur", description: e.message || "Échec de l'approbation", variant: "destructive" }),
    });

    const declineMutation = useMutation({
        mutationFn: ({ id, reason }: { id: number; reason?: string }) => epreuveSubmissionsService.decline(id, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            setDeclineTarget(null);
            setDeclineReason("");
            toast({ title: "Soumission refusée", description: "L'auteur a été notifié par email." });
        },
        onError: (e: any) => toast({ title: "Erreur", description: e.message || "Échec du refus", variant: "destructive" }),
    });

    const handleLimitChange = (val: string) => { setLimit(parseInt(val)); setPage(1); };

    // Open the submitted PDF in a new tab using the Cloudflare R2 presigned URL
    // ONLY (private slot) — never the legacy Firebase link. Open the tab
    // synchronously (inside the click) so the browser doesn't block the popup.
    const viewFile = async (sub: EpreuveSubmission) => {
        const win = window.open("", "_blank");
        try {
            const res = await filesService.getDownloadUrl("epreuve_submissions", sub.uuid, "file");
            if (res?.url) { if (win) win.location.href = res.url; else window.open(res.url, "_blank", "noopener"); }
            else { win?.close(); toast({ title: "Fichier indisponible", description: "Impossible de générer le lien R2 du fichier.", variant: "destructive" }); }
        } catch (e: any) {
            win?.close();
            toast({ title: "Erreur", description: e?.message || "Impossible d'ouvrir le fichier depuis R2.", variant: "destructive" });
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-foreground">Épreuves en attente</h1>
                <p className="text-muted-foreground">Résolvez les parents manquants, puis approuvez ou refusez les épreuves soumises</p>
            </div>

            <Card className="shadow-md">
                <CardHeader>
                    <CardTitle>Soumissions</CardTitle>
                    <CardDescription>
                        <div className="flex flex-col md:flex-row gap-4 mt-4 items-center">
                            <Select value={selectedStatus} onValueChange={(v) => { setSelectedStatus(v); setPage(1); }}>
                                <SelectTrigger className="w-full md:w-[220px]">
                                    <SelectValue placeholder="Filtrer par statut" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="pending_approval">En Attente</SelectItem>
                                    <SelectItem value="approved">Approuvées</SelectItem>
                                    <SelectItem value="declined">Refusées</SelectItem>
                                    <SelectItem value="ALL">Tous les statuts</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={selectedType} onValueChange={(v) => { setSelectedType(v); setPage(1); }}>
                                <SelectTrigger className="w-full md:w-[200px]">
                                    <SelectValue placeholder="Filtrer par type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Tous les types</SelectItem>
                                    <SelectItem value="Examens">Examens</SelectItem>
                                    <SelectItem value="Examens Nationaux">Examens Nationaux</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-sm text-muted-foreground whitespace-nowrap">Items par page:</span>
                                <Select value={limit.toString()} onValueChange={handleLimitChange}>
                                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="5">5</SelectItem>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                        <SelectItem value="50">50</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                    ) : error ? (
                        <div className="text-center py-8 text-destructive">Erreur lors du chargement des soumissions</div>
                    ) : (
                        <>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Titre</TableHead>
                                        <TableHead>Chaîne (Étab. › Filière › Niveau › Matière)</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Année</TableHead>
                                        <TableHead>Section</TableHead>
                                        <TableHead>Auteur</TableHead>
                                        <TableHead>Statut</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {submissions.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center text-muted-foreground">Aucune soumission trouvée.</TableCell>
                                        </TableRow>
                                    ) : submissions.map((sub) => {
                                        const hasMissing = sub.missing.etablissement || sub.missing.filiere || sub.missing.niveau_etude || sub.missing.matiere;
                                        const hasFile = !!(sub.file_path || sub.url);
                                        const isPending = sub.status === 'pending_approval';
                                        const approveTitle = hasMissing
                                            ? "Résolvez d'abord tous les parents"
                                            : !hasFile ? "En attente du fichier" : "Approuver";
                                        return (
                                            <TableRow key={sub.id}>
                                                <TableCell className="font-medium max-w-[180px] truncate" title={sub.titre}>{sub.titre}</TableCell>
                                                <TableCell><ChainCell submission={sub} /></TableCell>
                                                <TableCell>{sub.type ? <Badge variant="secondary" className="font-normal">{sub.type}</Badge> : '-'}</TableCell>
                                                <TableCell>{sub.annee || '-'}</TableCell>
                                                <TableCell className="capitalize">{sub.section || '-'}</TableCell>
                                                <TableCell>{sub.soumis_par ? `${sub.soumis_par.prenom} ${sub.soumis_par.nom}` : '-'}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col items-start gap-1">
                                                        <Badge variant={getStatusBadgeVariant(sub.status)}>{getStatusLabel(sub.status)}</Badge>
                                                        {isPending && !hasFile && (
                                                            <Badge variant="destructive" className="font-normal gap-1">
                                                                <FileWarning className="h-3 w-3" />
                                                                Fichier manquant
                                                            </Badge>
                                                        )}
                                                        {sub.transcription?.statut === 'en_cours' && (
                                                            <Badge variant="outline" className="font-normal">
                                                                Lecture {sub.transcription.pages_pretes}/{sub.transcription.pages_total ?? '?'}
                                                            </Badge>
                                                        )}
                                                        {sub.transcription?.statut === 'valide' && (
                                                            <Badge variant="default" className="font-normal">Transcription validée</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {hasFile && (
                                                            <Button variant="ghost" size="icon" onClick={() => viewFile(sub)} title="Voir le fichier soumis">
                                                                <Eye className="h-4 w-4 text-blue-500" />
                                                            </Button>
                                                        )}
                                                        {isPending && (
                                                            <>
                                                                <Button
                                                                    variant="ghost" size="icon"
                                                                    onClick={() => setReviewTarget({ uuid: sub.uuid, titre: sub.titre })}
                                                                    title="Relire ce que Ketsia lit du document"
                                                                    disabled={!hasFile}
                                                                >
                                                                    <ScanText className={`h-4 w-4 ${sub.transcription?.statut === 'valide' ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                                                                </Button>
                                                                <Button variant="ghost" size="icon" onClick={() => setResolveTarget(sub)} title={hasMissing ? "Résoudre les parents manquants" : "Modifier la soumission"}>
                                                                    <Wrench className={`h-4 w-4 ${hasMissing ? 'text-orange-500' : 'text-muted-foreground'}`} />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost" size="icon"
                                                                    onClick={() => approveMutation.mutate(sub.id)}
                                                                    title={approveTitle}
                                                                    disabled={hasMissing || !hasFile || approveMutation.isPending}
                                                                >
                                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost" size="icon"
                                                                    onClick={() => setDeclineTarget(sub)}
                                                                    title="Refuser"
                                                                    disabled={declineMutation.isPending}
                                                                >
                                                                    <XCircle className="h-4 w-4 text-destructive" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center space-x-2 py-4">
                                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="text-sm text-muted-foreground">Page {page} sur {totalPages}</div>
                                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <ResolveDialog
                submission={resolveTarget}
                open={!!resolveTarget}
                onOpenChange={(o) => !o && setResolveTarget(null)}
            />

            <Dialog open={!!declineTarget} onOpenChange={(o) => { if (!o) { setDeclineTarget(null); setDeclineReason(""); } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Refuser la soumission</DialogTitle>
                        <DialogDescription>L'auteur sera notifié par email. Vous pouvez préciser un motif (optionnel).</DialogDescription>
                    </DialogHeader>
                    <Textarea
                        placeholder="Motif du refus (optionnel)…"
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDeclineTarget(null); setDeclineReason(""); }}>Annuler</Button>
                        <Button
                            variant="destructive"
                            onClick={() => declineTarget && declineMutation.mutate({ id: declineTarget.id, reason: declineReason.trim() || undefined })}
                            disabled={declineMutation.isPending}
                        >
                            {declineMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Refuser
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <TranscriptionReviewDialog
                target={reviewTarget ? { kind: "submission", uuid: reviewTarget.uuid } : null}
                titre={reviewTarget?.titre}
                open={reviewTarget !== null}
                onOpenChange={(open) => !open && setReviewTarget(null)}
                // L'approbation est refusée tant que la transcription n'est pas
                // tranchée : sans ce rafraîchissement, la ligne garderait son
                // ancien état et le bouton Approuver continuerait d'échouer.
                onDecision={() => queryClient.invalidateQueries({ queryKey: ['admin-submissions'] })}
            />
        </div>
    );
}
