import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock,
  History,
  Loader2,
  Search,
  HandCoins,
  RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Abonnement,
  abonnementsService,
  estReellementActif,
  StatutAbonnement,
} from "@/lib/services/abonnements.service";

const STATUTS: { valeur: StatutAbonnement | "TOUS"; libelle: string }[] = [
  { valeur: "TOUS", libelle: "Tous les statuts" },
  { valeur: "EN_ATTENTE", libelle: "En attente" },
  { valeur: "ACTIF", libelle: "Actif" },
  { valeur: "EXPIRE", libelle: "Expiré" },
  { valeur: "ANNULE", libelle: "Annulé" },
  { valeur: "REMBOURSE", libelle: "Remboursé" },
];

const variante = (a: Abonnement): "default" | "secondary" | "destructive" | "outline" => {
  if (a.statut === "ACTIF") return estReellementActif(a) ? "default" : "outline";
  if (a.statut === "EN_ATTENTE") return "secondary";
  if (a.statut === "ANNULE" || a.statut === "REMBOURSE") return "destructive";
  return "outline";
};

const dateCourte = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const nomComplet = (a: Abonnement) =>
  [a.utilisateur?.prenom, a.utilisateur?.nom].filter(Boolean).join(" ") || `#${a.utilisateur_id}`;

export default function Abonnements() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [recherche, setRecherche] = useState("");
  const rechercheDifferee = useDebounce(recherche, 500);
  const [statut, setStatut] = useState<StatutAbonnement | "TOUS">("TOUS");
  const [page, setPage] = useState(1);
  const limit = 10;

  const [cible, setCible] = useState<Abonnement | null>(null);
  const [cibleReactivation, setCibleReactivation] = useState<Abonnement | null>(null);
  const [motifReactivation, setMotifReactivation] = useState("");
  const [montant, setMontant] = useState<number>(0);
  const [reference, setReference] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [journalUuid, setJournalUuid] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["abonnements", "liste", rechercheDifferee, statut, page],
    queryFn: () =>
      abonnementsService.getAbonnements({
        page,
        limit,
        search: rechercheDifferee || undefined,
        statut: statut === "TOUS" ? undefined : statut,
      }),
  });

  const { data: commissionsDues } = useQuery({
    queryKey: ["abonnements", "commissions-en-attente"],
    queryFn: () => abonnementsService.getCommissionsEnAttente(),
  });

  const rattrapage = useMutation({
    mutationFn: (uuid: string) => abonnementsService.rattraperCommission(uuid),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["abonnements"] });
      toast({
        title: r.verse ? "Commission versée" : "Commission non versée",
        description: r.verse
          ? "Le wallet du parrain a été crédité."
          : `Motif : ${r.motif ?? "le wallet a refusé le crédit"}.`,
        variant: r.verse ? undefined : "destructive",
      });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec", variant: "destructive" }),
  });

  const { data: journal, isLoading: journalCharge } = useQuery({
    queryKey: ["abonnements", "evenements", journalUuid],
    queryFn: () => abonnementsService.getEvenements(journalUuid!),
    enabled: !!journalUuid,
  });

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ["abonnements", "liste"] });

  const activation = useMutation({
    mutationFn: () =>
      abonnementsService.activer(cible!.uuid, {
        montant_paye: montant,
        reference_paiement: reference || undefined,
        commentaire: commentaire || undefined,
      }),
    onSuccess: (a) => {
      rafraichir();
      setCible(null);
      toast({
        title: "Abonnement activé",
        description: `Valable jusqu'au ${dateCourte(a.date_fin)}.`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Activation impossible", description: e?.message || "Échec", variant: "destructive" }),
  });

  const annulation = useMutation({
    mutationFn: (uuid: string) => abonnementsService.annuler(uuid, "Annulé depuis le back-office"),
    onSuccess: () => {
      rafraichir();
      toast({ title: "Abonnement annulé" });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec", variant: "destructive" }),
  });

  const reactivation = useMutation({
    mutationFn: ({ uuid, motif }: { uuid: string; motif: string }) =>
      abonnementsService.reactiver(uuid, motif),
    onSuccess: (a) => {
      rafraichir();
      setCibleReactivation(null);
      setMotifReactivation("");
      toast({
        title: a.statut === "EXPIRE" ? "Abonnement restauré, mais échu" : "Abonnement réactivé",
        description:
          a.statut === "EXPIRE"
            ? "Sa date de fin était déjà passée : il est restauré en EXPIRÉ, pas en actif."
            : "Ses dates d'origine sont conservées.",
      });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec", variant: "destructive" }),
  });

  const ouvrirReactivation = (a: Abonnement) => {
    setCibleReactivation(a);
    setMotifReactivation("");
  };

  const ouvrirActivation = (a: Abonnement) => {
    setCible(a);
    setMontant(a.plan?.prix ?? 0);
    setReference("");
    setCommentaire("");
  };

  const abonnements = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Abonnements</h1>
        <p className="text-muted-foreground">
          Suivi des souscriptions et activation des paiements encaissés hors application
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, prénom ou email..."
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setPage(1);
            }}
            className="pl-10"
          />
        </div>
        <Select
          value={statut}
          onValueChange={(v) => {
            setStatut(v as StatutAbonnement | "TOUS");
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUTS.map((s) => (
              <SelectItem key={s.valeur} value={s.valeur}>
                {s.libelle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!!commissionsDues?.length && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HandCoins className="h-5 w-5 text-amber-500" />
              Commissions de parrainage en attente ({commissionsDues.length})
            </CardTitle>
            <CardDescription>
              Abonnements payés dont la commission n’a pas pu être versée — wallet du parrain bloqué
              au moment de l’activation, commission activée après coup, ou panne ponctuelle. Le
              versement est rejouable sans risque de double crédit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {commissionsDues.map((a) => (
              <div key={a.uuid} className="flex items-center justify-between rounded-lg border bg-background p-3">
                <div className="text-sm">
                  <div className="font-medium">{nomComplet(a)}</div>
                  <div className="text-muted-foreground">
                    {a.plan?.libelle} — {a.montant_paye.toLocaleString("fr-FR")} {a.devise}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rattrapage.isPending}
                  onClick={() => rattrapage.mutate(a.uuid)}
                >
                  Rattraper
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive">Erreur lors du chargement</div>
          ) : !abonnements.length ? (
            <div className="rounded-lg border bg-muted/10 py-8 text-center text-muted-foreground">
              Aucun abonnement pour ces critères.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead className="text-right">Payé</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abonnements.map((a) => (
                  <TableRow key={a.uuid}>
                    <TableCell>
                      <div className="font-medium">{nomComplet(a)}</div>
                      <div className="text-xs text-muted-foreground">{a.utilisateur?.email}</div>
                    </TableCell>
                    <TableCell>
                      <div>{a.plan?.libelle ?? "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{a.plan?.code}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={variante(a)}>{a.statut}</Badge>
                      {/* Un ACTIF dont la date est passée : le serveur refuse déjà
                          l'accès, mais le cron horaire n'a pas encore écrit EXPIRE.
                          Le signaler évite de croire l'abonné encore couvert. */}
                      {a.statut === "ACTIF" && !estReellementActif(a) && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                          <Clock className="h-3 w-3" />
                          échu, bascule en attente
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.date_debut ? (
                        <>
                          {dateCourte(a.date_debut)} → {dateCourte(a.date_fin)}
                        </>
                      ) : (
                        <span className="text-muted-foreground">non démarré</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.montant_paye ? `${a.montant_paye.toLocaleString("fr-FR")} ${a.devise}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {a.statut === "EN_ATTENTE" && (
                          <Button size="sm" onClick={() => ouvrirActivation(a)}>
                            <BadgeCheck className="mr-1 h-4 w-4" />
                            Activer
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setJournalUuid(a.uuid)}>
                          <History className="h-4 w-4" />
                        </Button>
                        {a.statut === "ANNULE" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={reactivation.isPending}
                            onClick={() => ouvrirReactivation(a)}
                          >
                            <RotateCcw className="mr-1 h-4 w-4" />
                            Réactiver
                          </Button>
                        )}
                        {["EN_ATTENTE", "ACTIF"].includes(a.statut) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={annulation.isPending}
                            onClick={() => annulation.mutate(a.uuid)}
                          >
                            <CircleSlash className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {page} sur {totalPages} — {data?.total} abonnement(s)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activation manuelle */}
      <Dialog open={!!cible} onOpenChange={(o) => !o && setCible(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activer l'abonnement</DialogTitle>
            <DialogDescription>
              À utiliser après avoir encaissé le paiement hors application. L'abonnement démarre
              maintenant, pour la durée du plan.
            </DialogDescription>
          </DialogHeader>

          {cible && (
            <div className="grid gap-4 py-2">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="font-medium">{nomComplet(cible)}</div>
                <div className="text-muted-foreground">
                  {cible.plan?.libelle} — {cible.plan?.duree_jours} jours
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="montant">Montant encaissé ({cible.devise})</Label>
                <Input
                  id="montant"
                  type="number"
                  min={0}
                  value={montant}
                  onChange={(e) => setMontant(Number(e.target.value))}
                />
                {cible.plan && montant !== cible.plan.prix && (
                  <p className="text-xs text-amber-600">
                    Différent du prix du plan ({cible.plan.prix.toLocaleString("fr-FR")}{" "}
                    {cible.plan.devise}).
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reference">Référence du paiement</Label>
                <Input
                  id="reference"
                  placeholder="MoMo 2026-09-06 12:31"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Conservée dans le journal de l'abonnement — la seule trace de l'encaissement tant
                  que le paiement en ligne n'est pas en service.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="commentaire">Commentaire</Label>
                <Textarea
                  id="commentaire"
                  value={commentaire}
                  onChange={(e) => setCommentaire(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCible(null)}>
              Annuler
            </Button>
            <Button onClick={() => activation.mutate()} disabled={activation.isPending || montant < 0}>
              {activation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Journal */}
      <Dialog open={!!journalUuid} onOpenChange={(o) => !o && setJournalUuid(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Journal de l'abonnement</DialogTitle>
            <DialogDescription>Historique complet, du plus récent au plus ancien.</DialogDescription>
          </DialogHeader>

          {journalCharge ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !journal?.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Aucun évènement.</p>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {journal.map((e) => (
                <div key={e.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{e.type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.date_creation).toLocaleString("fr-FR")}
                    </span>
                  </div>
                  {e.payload && (
                    <pre className="mt-2 overflow-x-auto text-xs text-muted-foreground">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!cibleReactivation} onOpenChange={(o) => !o && setCibleReactivation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revenir sur l'annulation</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  L'abonnement retrouve son statut avec ses <strong>dates d'origine</strong> — du{" "}
                  {cibleReactivation?.date_debut
                    ? new Date(cibleReactivation.date_debut).toLocaleDateString("fr-FR")
                    : "?"}{" "}
                  au{" "}
                  {cibleReactivation?.date_fin
                    ? new Date(cibleReactivation.date_fin).toLocaleDateString("fr-FR")
                    : "?"}
                  . L'abonné ne gagne pas une période pleine parce qu'une erreur a été corrigée.
                </p>
                {cibleReactivation?.date_fin &&
                  new Date(cibleReactivation.date_fin).getTime() <= Date.now() && (
                    <p className="text-amber-600">
                      Sa date de fin est déjà passée : il sera restauré en <strong>expiré</strong>,
                      pas en actif.
                    </p>
                  )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="motif-reactivation">Motif</Label>
            <Textarea
              id="motif-reactivation"
              placeholder="Annulation par erreur, paiement confirmé depuis…"
              value={motifReactivation}
              onChange={(e) => setMotifReactivation(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Consigné dans l'historique de l'abonnement, avec votre identifiant.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCibleReactivation(null)}>
              Annuler
            </Button>
            <Button
              disabled={reactivation.isPending || !motifReactivation.trim()}
              onClick={() =>
                reactivation.mutate({
                  uuid: cibleReactivation!.uuid,
                  motif: motifReactivation.trim(),
                })
              }
            >
              {reactivation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Réactiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
