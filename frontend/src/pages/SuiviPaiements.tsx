import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Loader2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  IssuePaiement,
  paiementsAdminService,
  StatutPaiement,
  SuiviFiltres,
  SuiviUtilisateur,
} from "@/lib/services/paiements-admin.service";

const PERIODES = [
  { valeur: "7", libelle: "7 derniers jours" },
  { valeur: "30", libelle: "30 derniers jours" },
  { valeur: "90", libelle: "90 derniers jours" },
  { valeur: "TOUT", libelle: "Depuis le début" },
];

const LIBELLES_STATUT: Record<StatutPaiement, string> = {
  INITIE: "Initié",
  EN_ATTENTE: "En attente",
  REUSSI: "Réussi",
  ECHOUE: "Échoué",
  ANNULE: "Annulé",
  EXPIRE: "Expiré",
  REMBOURSE: "Remboursé",
};

const variante = (s: StatutPaiement): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "REUSSI") return "default";
  if (s === "INITIE" || s === "EN_ATTENTE") return "secondary";
  if (s === "ECHOUE" || s === "ANNULE") return "destructive";
  return "outline";
};

const dateHeure = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const montants = (liste: { devise: string; montant: number }[]) =>
  liste.length ? liste.map((m) => `${m.montant.toLocaleString("fr-FR")} ${m.devise}`).join(" + ") : "—";

const nomComplet = (l: SuiviUtilisateur) =>
  [l.utilisateur.prenom, l.utilisateur.nom].filter(Boolean).join(" ") || l.utilisateur.email || "—";

const depuisPeriode = (periode: string) => {
  if (periode === "TOUT") return undefined;
  const d = new Date();
  d.setDate(d.getDate() - Number(periode));
  return d.toISOString().slice(0, 10);
};

const versCsv = (lignes: SuiviUtilisateur[]) => {
  const echapper = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const entete = ["Nom", "Email", "Téléphone", "Issue", "Tentatives", "Réussies", "Dernier statut", "Dernière tentative", "Montant payé"];
  const corps = lignes.map((l) =>
    [nomComplet(l), l.utilisateur.email, l.utilisateur.telephone, l.issue === "ABOUTI" ? "Abouti" : "Non abouti",
      l.tentatives, l.reussies, LIBELLES_STATUT[l.dernier_statut], dateHeure(l.derniere_tentative), montants(l.montant_paye)]
      .map(echapper)
      .join(","),
  );
  return [entete.map(echapper).join(","), ...corps].join("\n");
};

export default function SuiviPaiements() {
  const { toast } = useToast();
  const [issue, setIssue] = useState<IssuePaiement | "TOUS">("NON_ABOUTI");
  const [periode, setPeriode] = useState("30");
  const [recherche, setRecherche] = useState("");
  const rechercheDifferee = useDebounce(recherche, 500);
  const [page, setPage] = useState(1);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [export_, setExport] = useState(false);
  const limit = 20;

  const filtres: SuiviFiltres = {
    issue: issue === "TOUS" ? undefined : issue,
    depuis: depuisPeriode(periode),
    search: rechercheDifferee || undefined,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["paiements", "suivi", filtres, page],
    queryFn: () => paiementsAdminService.getSuivi({ ...filtres, page, limit }),
  });

  const exporter = async () => {
    setExport(true);
    try {
      const lignes: SuiviUtilisateur[] = [];
      for (let p = 1; ; p++) {
        const r = await paiementsAdminService.getSuivi({ ...filtres, page: p, limit: 100 });
        lignes.push(...r.data);
        if (p >= r.totalPages) break;
      }
      const url = URL.createObjectURL(new Blob(["﻿" + versCsv(lignes)], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `suivi-paiements-${issue.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Export impossible", description: e instanceof Error ? e.message : "Échec", variant: "destructive" });
    } finally {
      setExport(false);
    }
  };

  const resume = data?.resume;
  const lignes = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Suivi des paiements</h1>
        <p className="text-muted-foreground">
          Qui a lancé un paiement, qui l'a mené au bout — un utilisateur qui réussit après un échec compte comme abouti
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { titre: "Ont tenté de payer", valeur: resume?.utilisateurs, detail: `${resume?.tentatives ?? 0} tentative(s)` },
          { titre: "Aboutis", valeur: resume?.aboutis, detail: `${resume?.taux_conversion ?? 0} % de conversion` },
          { titre: "Non aboutis", valeur: resume?.non_aboutis, detail: "aucune tentative réussie" },
          { titre: "Encaissé", valeur: resume ? montants(resume.encaisse) : undefined, detail: "paiements réussis" },
        ].map((c) => (
          <Card key={c.titre}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.titre}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.valeur ?? "—"}</div>
              <p className="text-xs text-muted-foreground">{c.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <Tabs
          value={issue}
          onValueChange={(v) => {
            setIssue(v as IssuePaiement | "TOUS");
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="NON_ABOUTI">Non aboutis</TabsTrigger>
            <TabsTrigger value="ABOUTI">Aboutis</TabsTrigger>
            <TabsTrigger value="TOUS">Tous</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, email ou téléphone..."
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setPage(1);
            }}
            className="pl-10"
          />
        </div>
        <Select
          value={periode}
          onValueChange={(v) => {
            setPeriode(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="lg:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODES.map((p) => (
              <SelectItem key={p.valeur} value={p.valeur}>
                {p.libelle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exporter} disabled={export_ || !lignes.length}>
          {export_ ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Exporter CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive">Erreur lors du chargement</div>
          ) : !lignes.length ? (
            <div className="rounded-lg border bg-muted/10 py-8 text-center text-muted-foreground">
              Aucun utilisateur pour ces critères.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead className="text-right">Tentatives</TableHead>
                    <TableHead>Dernier statut</TableHead>
                    <TableHead>Dernière tentative</TableHead>
                    <TableHead className="text-right">Payé</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lignes.map((l) => {
                    const deplie = ouvert === l.utilisateur.uuid;
                    return (
                      <Fragment key={l.utilisateur.uuid}>
                        <TableRow className="cursor-pointer" onClick={() => setOuvert(deplie ? null : l.utilisateur.uuid)}>
                          <TableCell>
                            <div className="font-medium">{nomComplet(l)}</div>
                            <div className="text-xs text-muted-foreground">
                              {[l.utilisateur.email, l.utilisateur.telephone].filter(Boolean).join(" · ")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={l.issue === "ABOUTI" ? "default" : "destructive"}>
                              {l.issue === "ABOUTI" ? "Abouti" : "Non abouti"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {l.reussies}/{l.tentatives}
                          </TableCell>
                          <TableCell>
                            <Badge variant={variante(l.dernier_statut)}>{LIBELLES_STATUT[l.dernier_statut]}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{dateHeure(l.derniere_tentative)}</TableCell>
                          <TableCell className="text-right">{montants(l.montant_paye)}</TableCell>
                          <TableCell className="text-right">
                            {deplie ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </TableCell>
                        </TableRow>
                        {deplie && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7}>
                              <div className="space-y-2 py-2">
                                {l.paiements.map((p) => (
                                  <div key={p.uuid} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                    <Badge variant={variante(p.statut)}>{LIBELLES_STATUT[p.statut]}</Badge>
                                    <span className="w-40">{dateHeure(p.date_creation)}</span>
                                    <span className="w-20">{p.prestataire}</span>
                                    <span className="w-32">
                                      {Number(p.montant).toLocaleString("fr-FR")} {p.devise}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {p.commande_id ? "Achat groupé" : "Abonnement"}
                                    </span>
                                    <span className="font-mono text-xs text-muted-foreground">{p.reference}</span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {page} / {totalPages} — {data?.total} utilisateur(s)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
