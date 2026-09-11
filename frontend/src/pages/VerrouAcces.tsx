import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Info, Loader2, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { abonnementsService, EtatVerrou } from "@/lib/services/abonnements.service";

const dateFr = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

function Interrupteur({ etat }: { etat: EtatVerrou }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<boolean | null>(null);

  const basculer = useMutation({
    mutationFn: (actif: boolean) => abonnementsService.setVerrou(actif),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["abonnements", "verrou"] });
      toast({
        title: r.verrou_actif ? "Verrou activé" : "Verrou désactivé",
        description: r.verrou_actif
          ? "Les refus s’appliquent immédiatement."
          : "Les refus redeviennent de simples lignes de journal.",
      });
    },
    onError: (e: any) =>
      toast({ title: "Erreur", description: e?.message || "Échec de la bascule", variant: "destructive" }),
  });

  const actif = etat.verrou_actif;

  return (
    <>
      <Card className={actif ? "border-emerald-500/40" : "border-amber-500/40"}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <div
                className={`mt-0.5 rounded-lg p-2 ${
                  actif ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                }`}
              >
                {actif ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}
              </div>
              <div>
                <CardTitle>Verrou d’accès</CardTitle>
                <CardDescription className="mt-1">
                  L’interrupteur qui décide si les refus sont réellement appliqués, ou seulement
                  calculés et journalisés.
                </CardDescription>
              </div>
            </div>
            <Badge variant={actif ? "default" : "secondary"}>{actif ? "Appliqué" : "Observation"}</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <Label>Appliquer les refus</Label>
              <p className="max-w-xl text-xs text-muted-foreground">
                {actif
                  ? "Au-delà des quotas gratuits, les ressources sont refusées. Les concours exigent un abonnement."
                  : "Rien n’est refusé. Le serveur journalise ce qu’il aurait refusé, sous la mention [verrou éteint]."}
              </p>
            </div>
            <Switch
              checked={actif}
              disabled={basculer.isPending}
              onCheckedChange={(v) => setConfirmation(v)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Origine de la valeur</p>
              <p className="mt-1 text-sm text-foreground">
                {etat.origine === "base" ? (
                  <>
                    Bascule enregistrée
                    {etat.date_modification && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {dateFr(etat.date_modification)}
                        {etat.modifie_par ? ` par l’utilisateur ${etat.modifie_par}` : ""}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    Configuration de déploiement
                    <span className="text-muted-foreground">
                      {" "}
                      — aucune bascule n’a encore eu lieu
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Valeur du déploiement (repli)
              </p>
              <p className="mt-1 text-sm text-foreground">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  ABONNEMENTS_VERROU_ACTIF={String(etat.valeur_environnement)}
                </code>
              </p>
            </div>
          </div>

          {basculer.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Bascule en cours…
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmation !== null} onOpenChange={(o) => !o && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation ? "Appliquer les refus à tous les utilisateurs ?" : "Cesser d’appliquer les refus ?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirmation ? (
                  <>
                    <p>
                      À partir de maintenant, un utilisateur sans abonnement se verra refuser les
                      ressources académiques au-delà de son quota gratuit, et les concours dès la
                      première consultation.
                    </p>
                    <p className="text-muted-foreground">
                      Les administrateurs ne sont jamais concernés. La bascule prend effet
                      immédiatement, et se défait aussi vite depuis cette page.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Les refus redeviennent de simples lignes de journal : tout redevient
                      accessible, quotas dépassés compris.
                    </p>
                    <p className="text-muted-foreground">
                      Les consommations déjà enregistrées sont conservées ; elles cessent
                      simplement d’être opposées aux utilisateurs.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmation !== null) basculer.mutate(confirmation);
                setConfirmation(null);
              }}
            >
              {confirmation ? "Activer le verrou" : "Désactiver le verrou"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function VerrouAcces() {
  const { data: etat, isLoading, error } = useQuery({
    queryKey: ["abonnements", "verrou"],
    queryFn: () => abonnementsService.getVerrou(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Verrou d’accès</h1>
        <p className="text-muted-foreground">
          Appliquer, ou non, les refus calculés par les plans, les quotas et le seuil de profil
        </p>
      </div>

      <Card className="border-blue-500/40 bg-blue-500/5">
        <CardContent className="flex gap-3 pt-6">
          <Info className="h-5 w-5 shrink-0 text-blue-500" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Les plans, les quotas gratuits et le seuil de complétion décident de ce qui{" "}
              <em>devrait</em> être refusé. Cet interrupteur décide si ce refus est{" "}
              <strong className="text-foreground">réellement appliqué</strong>.
            </p>
            <p>
              Éteint, le serveur calcule la décision, la journalise sous la mention{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">[verrou éteint]</code> et sert
              la ressource quand même. C’est la phase d’observation : elle permet de mesurer combien
              d’utilisateurs seraient touchés avant de couper quoi que ce soit.
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error || !etat ? (
        <div className="py-8 text-center text-destructive">Erreur lors du chargement</div>
      ) : (
        <>
          <Interrupteur etat={etat} />

          {!etat.verrou_actif && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="flex gap-3 pt-6">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Aucun refus n’est appliqué.</p>
                  <p className="text-muted-foreground">
                    Les quotas sont comptés et les décisions calculées, mais tout est servi. Un
                    utilisateur ayant épuisé ses 5 ressources du mois continue d’y accéder.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {etat.verrou_actif && (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardContent className="flex gap-3 pt-6">
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Les refus s’appliquent.</p>
                  <p className="text-muted-foreground">
                    Au-delà des quotas gratuits, les ressources académiques renvoient 403. Les
                    concours exigent un abonnement actif. Les administrateurs conservent un accès
                    illimité.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
