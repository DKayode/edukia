import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Check, Loader2, Pencil, Plus, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  abonnementsService,
  PlanAbonnement,
  PlanPayload,
} from "@/lib/services/abonnements.service";

const FORMULAIRE_VIDE: PlanPayload = {
  code: "",
  libelle: "",
  description: "",
  avantages: [],
  prix: 0,
  devise: "XOF",
  duree_jours: 30,
  est_actif: false,
  ordre_affichage: 0,
};

export default function PlansAbonnement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOuvert, setDialogOuvert] = useState(false);
  const [planEdite, setPlanEdite] = useState<PlanAbonnement | null>(null);
  const [formulaire, setFormulaire] = useState<PlanPayload>(FORMULAIRE_VIDE);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["abonnements", "plans"],
    queryFn: () => abonnementsService.getPlans(),
  });

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ["abonnements", "plans"] });

  const enregistrement = useMutation({
    mutationFn: (payload: PlanPayload) => {
      // Les lignes vides du champ « avantages » sont écartées ici, pas à la
      // frappe : les retirer au fil de la saisie empêcherait d'appuyer sur
      // Entrée pour commencer la ligne suivante.
      const propre: PlanPayload = {
        ...payload,
        avantages: (payload.avantages ?? []).map((a) => a.trim()).filter(Boolean),
      };
      return planEdite
        ? abonnementsService.updatePlan(planEdite.uuid, propre)
        : abonnementsService.createPlan(propre);
    },
    onSuccess: () => {
      rafraichir();
      setDialogOuvert(false);
      toast({
        title: planEdite ? "Plan modifié" : "Plan créé",
        description: formulaire.est_actif
          ? "Le plan est ouvert : il apparaît dans l'application mobile."
          : "Le plan reste fermé, invisible du catalogue mobile.",
      });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec de l'enregistrement", variant: "destructive" }),
  });

  const bascule = useMutation({
    mutationFn: ({ plan, ouvrir }: { plan: PlanAbonnement; ouvrir: boolean }) =>
      ouvrir
        ? abonnementsService.updatePlan(plan.uuid, { est_actif: true })
        : abonnementsService.fermerPlan(plan.uuid),
    onSuccess: (_d, { ouvrir }) => {
      rafraichir();
      toast({
        title: ouvrir ? "Plan ouvert" : "Plan fermé",
        description: ouvrir
          ? "Il est désormais proposé dans l'application."
          : "Il disparaît du catalogue ; les abonnements en cours ne sont pas touchés.",
      });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec", variant: "destructive" }),
  });

  const ouvrirCreation = () => {
    setPlanEdite(null);
    setFormulaire(FORMULAIRE_VIDE);
    setDialogOuvert(true);
  };

  const ouvrirEdition = (plan: PlanAbonnement) => {
    setPlanEdite(plan);
    setFormulaire({
      code: plan.code,
      libelle: plan.libelle,
      description: plan.description ?? "",
      avantages: plan.avantages ?? [],
      prix: plan.prix,
      devise: plan.devise,
      duree_jours: plan.duree_jours,
      est_actif: plan.est_actif,
      ordre_affichage: plan.ordre_affichage,
    });
    setDialogOuvert(true);
  };

  const aucunPlanOuvert = !!plans?.length && plans.every((p) => !p.est_actif);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Plans d'abonnement</h1>
          <p className="text-muted-foreground">Catalogue proposé dans l'application mobile</p>
        </div>
        <Button onClick={ouvrirCreation}>
          <Plus className="mr-2 h-4 w-4" />
          Nouveau plan
        </Button>
      </div>

      {aucunPlanOuvert && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Aucun plan n'est ouvert.</p>
              <p className="text-muted-foreground">
                Le catalogue est vide côté mobile : personne ne peut s'abonner. C'est l'état attendu
                tant que le paiement en ligne n'est pas en service — un prix affiché sans moyen de
                payer n'aide personne. Ouvrez un plan quand l'encaissement sera disponible.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Plans
          </CardTitle>
          <CardDescription>
            Un plan fermé reste en base et conserve son historique : la fermeture est logique, jamais
            une suppression.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !plans?.length ? (
            <div className="rounded-lg border bg-muted/10 py-8 text-center text-muted-foreground">
              Aucun plan. Créez-en un pour commencer.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="text-right">Prix</TableHead>
                  <TableHead className="text-right">Durée</TableHead>
                  <TableHead>Ordre</TableHead>
                  <TableHead>Visible sur mobile</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.uuid}>
                    <TableCell className="font-mono text-xs">{plan.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{plan.libelle}</div>
                      {plan.description && (
                        <div className="text-xs text-muted-foreground">{plan.description}</div>
                      )}
                      {!!plan.avantages?.length && (
                        <ul className="mt-1.5 space-y-0.5">
                          {plan.avantages.map((a) => (
                            <li key={a} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!plan.avantages?.length && plan.est_actif && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-600">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>Aucun avantage décrit — le plan est en vente sans dire ce qu’il apporte.</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {plan.prix.toLocaleString("fr-FR")} {plan.devise}
                    </TableCell>
                    <TableCell className="text-right">{plan.duree_jours} j</TableCell>
                    <TableCell>{plan.ordre_affichage}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={plan.est_actif}
                          disabled={bascule.isPending}
                          onCheckedChange={(ouvrir) => bascule.mutate({ plan, ouvrir })}
                        />
                        <Badge variant={plan.est_actif ? "default" : "secondary"}>
                          {plan.est_actif ? "Ouvert" : "Fermé"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => ouvrirEdition(plan)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{planEdite ? "Modifier le plan" : "Nouveau plan"}</DialogTitle>
            <DialogDescription>
              Le prix et la durée s'appliquent aux nouvelles souscriptions ; les abonnements en cours
              gardent leurs conditions.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  placeholder="MENSUEL"
                  value={formulaire.code}
                  onChange={(e) => setFormulaire({ ...formulaire, code: e.target.value.toUpperCase() })}
                />
                <p className="text-xs text-muted-foreground">Majuscules, chiffres et « _ ».</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ordre">Ordre d'affichage</Label>
                <Input
                  id="ordre"
                  type="number"
                  value={formulaire.ordre_affichage}
                  onChange={(e) =>
                    setFormulaire({ ...formulaire, ordre_affichage: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="libelle">Libellé</Label>
              <Input
                id="libelle"
                placeholder="Abonnement mensuel"
                value={formulaire.libelle}
                onChange={(e) => setFormulaire({ ...formulaire, libelle: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Accès illimité pendant 1 mois"
                value={formulaire.description ?? ""}
                onChange={(e) => setFormulaire({ ...formulaire, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="avantages">Ce que l'abonnement débloque</Label>
              <Textarea
                id="avantages"
                rows={5}
                placeholder={"Épreuves en illimité\nConcours : téléchargement des sujets\nKetsia, l'assistante IA, sans limite"}
                value={(formulaire.avantages ?? []).join("\n")}
                onChange={(e) =>
                  setFormulaire({
                    ...formulaire,
                    // Une ligne par avantage. Les lignes vides sont écartées à
                    // l'enregistrement plutôt qu'à la frappe, sinon impossible
                    // d'appuyer sur Entrée pour commencer la suivante.
                    avantages: e.target.value.split("\n"),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Une ligne par avantage — c'est ce que l'utilisateur lit avant de payer. N'y écrivez
                pas les plafonds gratuits : ils se règlent dans <strong>Quotas gratuits</strong> et
                la mention deviendrait fausse à la première modification.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prix">Prix</Label>
                <Input
                  id="prix"
                  type="number"
                  min={0}
                  value={formulaire.prix}
                  onChange={(e) => setFormulaire({ ...formulaire, prix: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="devise">Devise</Label>
                <Input
                  id="devise"
                  value={formulaire.devise}
                  onChange={(e) => setFormulaire({ ...formulaire, devise: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duree">Durée (jours)</Label>
                <Input
                  id="duree"
                  type="number"
                  min={1}
                  value={formulaire.duree_jours}
                  onChange={(e) => setFormulaire({ ...formulaire, duree_jours: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Ouvrir ce plan</Label>
                <p className="text-xs text-muted-foreground">
                  Un plan ouvert apparaît immédiatement dans l'application mobile.
                </p>
              </div>
              <Switch
                checked={!!formulaire.est_actif}
                onCheckedChange={(v) => setFormulaire({ ...formulaire, est_actif: v })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOuvert(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrement.mutate(formulaire)}
              disabled={
                enregistrement.isPending ||
                !formulaire.code.trim() ||
                !formulaire.libelle.trim() ||
                formulaire.duree_jours < 1
              }
            >
              {enregistrement.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
