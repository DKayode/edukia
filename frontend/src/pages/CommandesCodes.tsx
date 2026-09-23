import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Info, Loader2, PackageCheck, RefreshCw, Search, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { codesService, CommandeGroupee } from "@/lib/services/codes.service";

const nombre = (n: number) => n.toLocaleString("fr-FR");
const dateFr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const TEINTE: Record<CommandeGroupee["statut"], "default" | "secondary" | "destructive"> = {
  PAYEE: "default",
  EN_ATTENTE: "secondary",
  ANNULEE: "destructive",
  REMBOURSEE: "destructive",
};

function CodesDeLaCommande({ uuid, onClose }: { uuid: string | null; onClose: () => void }) {
  const { data: codes, isLoading } = useQuery({
    queryKey: ["commandes-codes", uuid],
    queryFn: () => codesService.codesDeLaCommande(uuid!),
    enabled: !!uuid,
  });

  return (
    <Dialog open={!!uuid} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Codes de la commande</DialogTitle>
          <DialogDescription>
            Qui a utilisé quoi, et quand. C’est la réponse à « j’ai distribué mes codes, où en
            sont-ils ? ».
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !codes?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucun code — la commande n’a pas encore été payée.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead>Bénéficiaire</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell>
                      {c.utilise_le ? (
                        <span className="text-xs text-muted-foreground">{dateFr(c.utilise_le)}</span>
                      ) : (
                        <Badge variant="secondary">Disponible</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.beneficiaire_nom || c.beneficiaire_email || "—"}
                      {c.beneficiaire_nom && c.beneficiaire_email && (
                        <span className="block text-muted-foreground">{c.beneficiaire_email}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CommandesCodes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statut, setStatut] = useState<string>("TOUS");
  const [recherche, setRecherche] = useState("");
  const [terme, setTerme] = useState("");
  const [detail, setDetail] = useState<string | null>(null);

  const { data: commandes, isLoading, isError } = useQuery({
    queryKey: ["commandes-groupees", statut, terme],
    queryFn: () =>
      codesService.commandes({
        statut: statut === "TOUS" ? undefined : statut,
        recherche: terme || undefined,
      }),
  });

  const completer = useMutation({
    mutationFn: (uuid: string) => codesService.completerCommande(uuid),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["commandes-groupees"] });
      toast({
        title: "Livraison complétée",
        description: `${r.codes_ajoutes} code(s) ajouté(s) et envoyé(s) à l’acheteur.`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec", variant: "destructive" }),
  });

  const incompletes = commandes?.filter((c) => c.livraison_incomplete) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Achats groupés</h1>
        <p className="text-muted-foreground">
          Les commandes de plusieurs abonnements, distribués en codes à usage unique
        </p>
      </div>

      {incompletes.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {incompletes.length} commande(s) payée(s) dont les codes manquent.
              </p>
              <p className="text-muted-foreground">
                L’acheteur a payé et n’a pas reçu son compte. Utilisez « Compléter » sur la ligne
                concernée : seuls les codes manquants seront engendrés, ceux déjà envoyés ne seront
                pas dupliqués.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-blue-500/40 bg-blue-500/5">
        <CardContent className="flex gap-3 pt-6">
          <Info className="h-5 w-5 shrink-0 text-blue-500" />
          <p className="text-sm text-muted-foreground">
            Une commande <strong>en attente</strong> n’a engendré aucun code : c’est l’état normal
            avant paiement, pas un incident. Les codes naissent à la confirmation du paiement et
            partent aussitôt par courriel.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="recherche">Rechercher</Label>
            <div className="flex gap-2">
              <Input
                id="recherche"
                placeholder="Nom, courriel ou identifiant de commande"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setTerme(recherche)}
              />
              <Button variant="outline" onClick={() => setTerme(recherche)}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Statut</Label>
            <Select value={statut} onValueChange={setStatut}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TOUS">Tous</SelectItem>
                <SelectItem value="EN_ATTENTE">En attente de paiement</SelectItem>
                <SelectItem value="PAYEE">Payée</SelectItem>
                <SelectItem value="ANNULEE">Annulée</SelectItem>
                <SelectItem value="REMBOURSEE">Remboursée</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="py-8 text-center text-destructive">Erreur lors du chargement</div>
      ) : !commandes?.length ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Ticket className="mx-auto mb-3 h-8 w-8 opacity-40" />
            Aucune commande groupée{terme || statut !== "TOUS" ? " pour ce filtre" : " pour l’instant"}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Acheteur</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Codes</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Payée le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commandes.map((c) => (
                  <TableRow key={c.uuid} className={c.livraison_incomplete ? "bg-destructive/5" : undefined}>
                    <TableCell>
                      <div className="font-medium">{c.acheteur.nom ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.acheteur.email ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{c.plan.libelle ?? c.plan.code ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.statut === "PAYEE" ? (
                        <span className={c.livraison_incomplete ? "font-semibold text-destructive" : ""}>
                          {c.codes_livres} / {c.quantite}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{c.quantite} attendus</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {nombre(c.montant_total)} {c.devise}
                      <span className="block text-xs text-muted-foreground">
                        {nombre(c.prix_unitaire)} × {c.quantite}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TEINTE[c.statut]}>{c.statut.replace("_", " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{dateFr(c.date_paiement)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {c.statut === "PAYEE" && (
                          <Button variant="ghost" size="sm" onClick={() => setDetail(c.uuid)}>
                            <Ticket className="mr-1 h-4 w-4" />
                            Codes
                          </Button>
                        )}
                        {c.livraison_incomplete && (
                          <Button
                            size="sm"
                            disabled={completer.isPending}
                            onClick={() => completer.mutate(c.uuid)}
                          >
                            {completer.isPending ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-1 h-4 w-4" />
                            )}
                            Compléter
                          </Button>
                        )}
                        {c.statut === "PAYEE" && !c.livraison_incomplete && (
                          <span
                            className="flex items-center text-xs text-emerald-600"
                            title="Tous les codes ont été livrés"
                          >
                            <PackageCheck className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CodesDeLaCommande uuid={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
