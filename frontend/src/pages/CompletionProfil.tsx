import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Info, Loader2, Save, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DistributionProfil,
  profilCompletionService,
  ReglageProfil,
} from "@/lib/services/profil-completion.service";

const nombre = (n: number) => n.toLocaleString("fr-FR");

/**
 * Combien de comptes atteignent `seuil`, calculé depuis la répartition brute.
 * Les paliers renvoyés par l'API sont espacés de 5 ou 10 points ; le seuil
 * réglé ici peut tomber entre deux, d'où ce recalcul côté page.
 */
const comptesAuSeuil = (distribution: DistributionProfil | undefined, seuil: number) =>
  distribution
    ? distribution.repartition
        .filter((l) => l.pourcentage >= seuil)
        .reduce((n, l) => n + l.comptes, 0)
    : 0;

function Impact({
  distribution,
  seuil,
  actif,
}: {
  distribution?: DistributionProfil;
  seuil: number;
  actif: boolean;
}) {
  if (!distribution) return null;

  const passent = comptesAuSeuil(distribution, seuil);
  const bloques = distribution.total - passent;
  const part = distribution.total ? Math.round((bloques * 1000) / distribution.total) / 10 : 0;
  const grave = part >= 50;

  return (
    <Card className={grave ? "border-destructive/50 bg-destructive/5" : "border-border"}>
      <CardHeader>
        <CardTitle className="text-base">Ce que ce seuil ferait aujourd’hui</CardTitle>
        <CardDescription>
          Sur les {nombre(distribution.total)} comptes actifs, mesuré à l’instant sur les données
          réelles.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="text-2xl font-bold text-foreground">{nombre(passent)}</p>
            <p className="text-sm text-muted-foreground">comptes conservent l’accès</p>
          </div>
          <div className={`rounded-lg border p-4 ${grave ? "border-destructive/50" : ""}`}>
            <p className={`text-2xl font-bold ${grave ? "text-destructive" : "text-foreground"}`}>
              {nombre(bloques)}
            </p>
            <p className="text-sm text-muted-foreground">
              comptes perdent l’accès ({part} %)
            </p>
          </div>
        </div>

        {grave && (
          <div className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-muted-foreground">
              À {seuil} %, <strong className="text-foreground">plus de la moitié</strong> des
              utilisateurs se verraient refuser épreuves, examens nationaux, concours et Ketsia.
              {actif
                ? " Le seuil est actif : ce refus s’applique déjà."
                : " Le seuil est inactif : rien n’est refusé tant que vous ne l’activez pas."}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Aux paliers usuels</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {distribution.passeraient.map((p) => (
              <div key={p.seuil} className="rounded-md border px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{p.seuil} %</span>
                <span className="text-muted-foreground">
                  {" — "}
                  {nombre(p.comptes)} ({p.part} %)
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Formulaire({
  reglage,
  distribution,
}: {
  reglage: ReglageProfil;
  distribution?: DistributionProfil;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [seuil, setSeuil] = useState(reglage.seuil_completion);
  const [actif, setActif] = useState(reglage.est_actif);
  const [exclus, setExclus] = useState<string[]>(reglage.champs_exclus ?? []);

  // Le formulaire suit la donnée serveur après enregistrement.
  useEffect(() => {
    setSeuil(reglage.seuil_completion);
    setActif(reglage.est_actif);
    setExclus(reglage.champs_exclus ?? []);
  }, [reglage.uuid, reglage.seuil_completion, reglage.est_actif, reglage.champs_exclus]);

  const modifie =
    seuil !== reglage.seuil_completion ||
    actif !== reglage.est_actif ||
    JSON.stringify([...exclus].sort()) !== JSON.stringify([...(reglage.champs_exclus ?? [])].sort());

  const comptes = reglage.champs_disponibles.length - exclus.length;

  // Avec N champs, chaque champ vaut 100/N points : un seuil placé au-dessus du
  // dernier palier atteignable avant 100 exige en réalité un profil complet.
  const equivautCent = useMemo(() => {
    if (comptes <= 0) return false;
    const avantDernier = Math.round((100 * (comptes - 1)) / comptes);
    return seuil > avantDernier && seuil <= 100;
  }, [seuil, comptes]);

  const enregistrer = useMutation({
    mutationFn: () =>
      profilCompletionService.updateReglage({
        seuil_completion: seuil,
        est_actif: actif,
        champs_exclus: exclus,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profil-completion"] });
      toast({
        title: "Seuil enregistré",
        description: actif
          ? "Il s’applique immédiatement, sans déploiement."
          : "Enregistré mais inactif : aucun accès n’est refusé.",
      });
    },
    onError: (e: any) =>
      toast({
        title: "Erreur",
        description: e?.message || "Échec de l’enregistrement",
        variant: "destructive",
      }),
  });

  const basculer = (champ: string, coche: boolean) =>
    setExclus((liste) => (coche ? liste.filter((c) => c !== champ) : [...liste, champ]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <UserCheck className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <div>
                <CardTitle>Seuil exigé</CardTitle>
                <CardDescription className="mt-1">
                  En dessous de ce pourcentage, l’utilisateur est invité à compléter son profil au
                  lieu d’accéder à la ressource.
                </CardDescription>
              </div>
            </div>
            <Badge variant={actif ? "default" : "secondary"}>{actif ? "Actif" : "Désactivé"}</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label>Complétion minimale</Label>
              <span className="text-2xl font-bold text-foreground">{seuil} %</span>
            </div>
            <Slider
              value={[seuil]}
              onValueChange={([v]) => setSeuil(v)}
              min={0}
              max={100}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              {comptes} champs comptés — chacun vaut {Math.round((1000 / comptes)) / 10} points.
            </p>
            {equivautCent && (
              <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-sm text-muted-foreground">
                  Avec {comptes} champs, {seuil} % revient exactement à{" "}
                  <strong className="text-foreground">exiger un profil complet</strong> : il n’existe
                  aucune valeur atteignable entre {Math.round((100 * (comptes - 1)) / comptes)} % et
                  100 %.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Appliquer ce seuil</Label>
              <p className="text-xs text-muted-foreground">
                Désactivé, la complétion est calculée et affichée mais ne bloque rien.
              </p>
            </div>
            <Switch checked={actif} onCheckedChange={setActif} />
          </div>

          <div className="space-y-3">
            <div>
              <Label>Champs comptés dans le calcul</Label>
              <p className="text-xs text-muted-foreground">
                Décocher un champ le retire du numérateur comme du dénominateur : il cesse d’être
                exigé sans pénaliser personne. Le taux indiqué est la part des comptes actifs qui
                l’ont réellement rempli — un champ à quelques pour cent bloque presque tout le
                monde à lui seul, quel que soit le seuil.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[...reglage.champs_disponibles]
                .sort((a, b) => b.part - a.part)
                .map((c) => {
                  const coche = !exclus.includes(c.champ);
                  // Sous 5 %, exiger le champ revient à refuser presque tout le
                  // monde : c'est l'information qui manquait pour décider.
                  const bloquant = c.part < 5;
                  return (
                    <label
                      key={c.champ}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                        coche && bloquant ? "border-amber-500/50 bg-amber-500/5" : ""
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={coche}
                        onCheckedChange={(v) => basculer(c.champ, v === true)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">{c.libelle}</span>
                        <span
                          className={`block text-xs tabular-nums ${
                            bloquant ? "font-medium text-amber-600" : "text-muted-foreground"
                          }`}
                        >
                          {c.part} % renseigné · {nombre(c.remplis)} comptes
                        </span>
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => enregistrer.mutate()} disabled={!modifie || enregistrer.isPending}>
              {enregistrer.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      <Impact distribution={distribution} seuil={seuil} actif={actif} />
    </div>
  );
}

export default function CompletionProfil() {
  const { data: reglage, isLoading, error } = useQuery({
    queryKey: ["profil-completion", "reglage"],
    queryFn: () => profilCompletionService.getReglage(),
  });

  const { data: distribution } = useQuery({
    queryKey: ["profil-completion", "distribution"],
    queryFn: () => profilCompletionService.getDistribution(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Complétion du profil</h1>
        <p className="text-muted-foreground">
          Exiger un profil renseigné avant de donner accès aux ressources
        </p>
      </div>

      {reglage && !reglage.est_actif && (
        <Card className="border-blue-500/40 bg-blue-500/5">
          <CardContent className="flex gap-3 pt-6">
            <Info className="h-5 w-5 shrink-0 text-blue-500" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Le seuil n’est pas appliqué.</p>
              <p className="text-muted-foreground">
                C’est l’état livré par défaut : la complétion est calculée et renvoyée à
                l’application mobile, qui peut inviter l’utilisateur à compléter son profil, mais
                aucun accès n’est refusé. Regardez l’impact ci-dessous avant d’activer.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error || !reglage ? (
        <div className="py-8 text-center text-destructive">Erreur lors du chargement</div>
      ) : (
        <Formulaire reglage={reglage} distribution={distribution} />
      )}
    </div>
  );
}
