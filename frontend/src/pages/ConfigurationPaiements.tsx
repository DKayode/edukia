import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, KeyRound, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ConfigurationPaiement,
  ConfigurationPaiementUpdate,
  ModePaiement,
  paiementsAdminService,
  PrestatairePaiement,
} from "@/lib/services/paiements-admin.service";

type Draft = {
  prestataire: PrestatairePaiement;
  mode: ModePaiement;
  devise: string;
  montant_min: string;
  montant_max: string;
  est_actif: boolean;
  credentials: Record<string, string>;
};

const PROVIDERS: Record<PrestatairePaiement, { label: string; fields: { key: string; label: string }[] }> = {
  KKIAPAY: {
    label: "KKiaPay",
    fields: [
      { key: "api_base_url", label: "URL API" },
      { key: "public_key", label: "Clé publique" },
      { key: "private_key", label: "Clé privée" },
      { key: "secret", label: "Secret" },
    ],
  },
  FEDAPAY: {
    label: "FedaPay",
    fields: [
      { key: "api_base_url", label: "URL API" },
      { key: "secret_key", label: "Clé secrète" },
      { key: "webhook_secret", label: "Secret webhook" },
    ],
  },
  STRIPE: {
    label: "Stripe",
    fields: [
      { key: "public_key", label: "Clé publiable (pk_...)" },
      { key: "secret_key", label: "Clé secrète (sk_...)" },
      { key: "webhook_secret", label: "Secret webhook (whsec_...)" },
    ],
  },
  REVENUECAT: {
    label: "RevenueCat",
    fields: [
      { key: "secret_key", label: "Clé secrète API" },
      { key: "webhook_authorization", label: "Authorization webhook" },
      { key: "webhook_secret", label: "Secret HMAC webhook" },
      { key: "entitlement_id", label: "Entitlement ID" },
    ],
  },
};

const MODES: { value: ModePaiement; label: string }[] = [
  { value: "sandbox", label: "Sandbox" },
  { value: "live", label: "Live" },
];

const emptyDraft = (prestataire: PrestatairePaiement): Draft => ({
  prestataire,
  mode: "sandbox",
  devise: prestataire === "STRIPE" || prestataire === "REVENUECAT" ? "EUR" : "XOF",
  montant_min: "",
  montant_max: "",
  est_actif: false,
  credentials: {},
});

export default function ConfigurationPaiements() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PrestatairePaiement>("KKIAPAY");
  const [selectedMode, setSelectedMode] = useState<ModePaiement>("sandbox");
  const [draft, setDraft] = useState<Draft>(emptyDraft("KKIAPAY"));

  const query = useQuery({
    queryKey: ["paiements-configurations"],
    queryFn: () => paiementsAdminService.getConfigurations(),
  });

  const current = useMemo(
    () => query.data?.find((item) => item.prestataire === selected && item.mode === selectedMode),
    [query.data, selected, selectedMode],
  );

  useEffect(() => {
    const next = current ? fromConfig(current) : { ...emptyDraft(selected), mode: selectedMode };
    setDraft(next);
  }, [current, selected, selectedMode]);

  const mutation = useMutation({
    mutationFn: (payload: ConfigurationPaiementUpdate) => paiementsAdminService.saveConfiguration(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paiements-configurations"] });
      toast({ title: "Configuration enregistrée", description: "Le prestataire est prêt pour les prochains paiements." });
    },
    onError: (error: unknown) => toast({ title: "Erreur", description: messageErreur(error), variant: "destructive" }),
  });

  const save = () => {
    const credentials = Object.fromEntries(
      Object.entries(draft.credentials).filter(([, value]) => value.trim() !== ""),
    );
    mutation.mutate({
      prestataire: draft.prestataire,
      mode: selectedMode,
      devise: draft.devise,
      montant_min: draft.montant_min === "" ? null : Number(draft.montant_min),
      montant_max: draft.montant_max === "" ? null : Number(draft.montant_max),
      est_actif: draft.est_actif,
      ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
    });
  };

  const setCredential = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, credentials: { ...prev.credentials, [key]: value } }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><CreditCard className="h-6 w-6" /></div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Paiements entrants</h1>
            <p className="text-muted-foreground">Configuration des prestataires pour les abonnements</p>
          </div>
        </div>
        <Button onClick={save} disabled={query.isLoading || mutation.isPending} className="gap-2">
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer
        </Button>
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">Impossible de charger les prestataires.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {(Object.keys(PROVIDERS) as PrestatairePaiement[]).map((provider) => {
              const activeConfig = query.data?.find((item) => item.prestataire === provider && item.est_actif);
              return (
                <div key={provider} className={`rounded-lg border p-3 transition-colors ${selected === provider ? "border-primary bg-primary/5" : "bg-background"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{PROVIDERS[provider].label}</p>
                    {activeConfig && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Actif {activeConfig.mode}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {MODES.map((mode) => {
                      const modeConfig = query.data?.find((item) => item.prestataire === provider && item.mode === mode.value);
                      const isSelected = selected === provider && selectedMode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => {
                            setSelected(provider);
                            setSelectedMode(mode.value);
                          }}
                          className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted/60"}`}
                        >
                          <span>{mode.label}</span>
                          <span className="mt-1 block font-normal opacity-80">{modeConfig?.devise ?? "XOF"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{PROVIDERS[selected].label}</CardTitle>
              <CardDescription>Les secrets existants sont masqués. Remplir un champ le remplace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Mode</Label>
                  <Select
                    value={selectedMode}
                    onValueChange={(mode) => {
                      const nextMode = mode as ModePaiement;
                      setSelectedMode(nextMode);
                      setDraft((d) => ({ ...d, mode: nextMode }));
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sandbox">Sandbox</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Devise</Label>
                  <Input value={draft.devise} onChange={(e) => setDraft((d) => ({ ...d, devise: e.target.value.toUpperCase() }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Montant minimum</Label>
                  <Input type="number" min={0} value={draft.montant_min} onChange={(e) => setDraft((d) => ({ ...d, montant_min: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Montant maximum</Label>
                  <Input type="number" min={0} value={draft.montant_max} onChange={(e) => setDraft((d) => ({ ...d, montant_max: e.target.value }))} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Prestataire actif</p>
                  <p className="text-xs text-muted-foreground">Active ou désactive ce prestataire pour ce pays. Plusieurs prestataires peuvent être actifs en même temps.</p>
                </div>
                <Switch checked={draft.est_actif} onCheckedChange={(est_actif) => setDraft((d) => ({ ...d, est_actif }))} />
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" /> Identifiants</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PROVIDERS[selected].fields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <Label>{field.label}</Label>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder={current?.credentials_masquees?.[field.key] ?? ""}
                        value={draft.credentials[field.key] ?? ""}
                        onChange={(e) => setCredential(field.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function fromConfig(config: ConfigurationPaiement): Draft {
  return {
    prestataire: config.prestataire,
    mode: config.mode,
    devise: config.devise,
    montant_min: config.montant_min == null ? "" : String(config.montant_min),
    montant_max: config.montant_max == null ? "" : String(config.montant_max),
    est_actif: config.est_actif,
    credentials: {},
  };
}

function messageErreur(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const err = error as { message?: string | string[]; error?: string };
    if (Array.isArray(err.message)) return err.message.join(", ");
    if (typeof err.message === "string") return err.message;
    if (typeof err.error === "string") return err.error;
  }
  return "Enregistrement impossible";
}
