import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  UserCheck,
  UserCircle,
  Cake,
  MapPin,
  Accessibility,
  LogIn,
  Activity,
  Loader2,
  BarChart3,
  GraduationCap,
  Zap,
  TrendingUp,
  Eye,
  Lightbulb,
  Briefcase,
  Wrench,
  CalendarDays,
  Route,
  MessagesSquare,
  Megaphone,
  MessageSquare,
  Heart,
  Wallet,
  Repeat,
  Info,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { kpiService, type KpiResponse, type ModuleAudience } from "@/lib/services/kpi.service";

// ---------- date helpers ----------
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt(d);
};
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return fmt(d);
};
const defaultEnd = () => fmt(new Date());
const defaultStart = () => monthsAgo(6);

const PRESETS: { label: string; start: () => string }[] = [
  { label: "7 j", start: () => daysAgo(7) },
  { label: "30 j", start: () => daysAgo(30) },
  { label: "6 mois", start: () => monthsAgo(6) },
  { label: "12 mois", start: () => monthsAgo(12) },
];

// ---------- accent palette (static strings for Tailwind JIT) ----------
type Accent = "primary" | "emerald" | "violet" | "amber" | "sky" | "rose";
const ACCENT_TILE: Record<Accent, string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-600",
  violet: "bg-violet-500/10 text-violet-600",
  amber: "bg-amber-500/10 text-amber-600",
  sky: "bg-sky-500/10 text-sky-600",
  rose: "bg-rose-500/10 text-rose-600",
};
const ACCENT_BAR: Record<Accent, string> = {
  primary: "bg-primary",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
};

const nf = (v: number) => v.toLocaleString("fr-FR");

// ---------- hero tile (top summary strip) ----------
function HeroTile({
  label,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: Accent;
  sub?: string;
}) {
  return (
    <Card className="relative overflow-hidden border-0 shadow-md">
      <span
        className={cn("absolute inset-x-0 top-0 h-1", ACCENT_BAR[accent])}
        aria-hidden
      />
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className={cn("rounded-lg p-2", ACCENT_TILE[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-card-foreground">
          {nf(value)}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------- detail stat card with share-of-total bar ----------
function StatCard({
  label,
  value,
  icon: Icon,
  accent = "primary",
  base,
  baseLabel = "part du total",
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: Accent;
  base?: number;
  baseLabel?: string;
}) {
  const pct =
    base && base > 0 ? Math.min(100, Math.round((value / base) * 100)) : null;
  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium leading-tight text-muted-foreground">
            {label}
          </p>
          <div className={cn("shrink-0 rounded-lg p-2", ACCENT_TILE[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums text-card-foreground">
          {nf(value)}
        </p>
        {pct !== null ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{baseLabel}</span>
              <span className="font-semibold text-foreground">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        ) : (
          <div className="mt-3 h-[1.375rem]" aria-hidden />
        )}
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  accent: Accent;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("rounded-lg p-2", ACCENT_TILE[accent])}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CardSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="shadow-sm">
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-1.5 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const ICONE_MODULE: Record<string, LucideIcon> = {
  opportunite: Lightbulb,
  offre: Briefcase,
  service: Wrench,
  evenement: CalendarDays,
  parcours: Route,
  forum: MessagesSquare,
  publicite: Megaphone,
};

const dateFr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;

/**
 * Dit d'où vient un chiffre creux. Sans cette mention, une période antérieure
 * au journal affiche des zéros qui se lisent comme un effondrement de l'usage
 * alors que rien n'a jamais été enregistré.
 */
function DepuisQuand({ depuis, quoi }: { depuis: string | null; quoi: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {depuis ? (
        <span>
          {quoi} depuis le <strong className="text-foreground">{dateFr(depuis)}</strong>. Une période
          antérieure affiche 0 par absence d'historique, pas par absence d'usage.
        </span>
      ) : (
        <span>
          {quoi} n'a encore rien enregistré. Les chiffres se rempliront à mesure que les fiches
          seront consultées.
        </span>
      )}
    </p>
  );
}

function CarteModule({ module, maxVues }: { module: ModuleAudience; maxVues: number }) {
  const Icone = ICONE_MODULE[module.type] ?? BarChart3;
  const pct = maxVues > 0 ? Math.round((module.vues / maxVues) * 100) : 0;

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-600">
              <Icone className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-foreground">{module.libelle}</p>
          </div>
        </div>

        <div className="flex items-baseline gap-4">
          <div>
            <p className="text-2xl font-bold tabular-nums text-card-foreground">{nf(module.vues)}</p>
            <p className="text-xs text-muted-foreground">consultations</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-card-foreground">
              {nf(module.utilisateurs)}
            </p>
            <p className="text-xs text-muted-foreground">utilisateurs</p>
          </div>
        </div>

        <Progress value={pct} className="h-1.5" />

        {module.top.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Les plus consultées</p>
            {module.top.map((t) => (
              <div key={t.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-foreground" title={t.titre}>
                  {t.titre}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                  {nf(t.vues)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/* ── Sections ─────────────────────────────────────────────────────────────
 * Une par domaine d'indicateurs. Elles sont extraites plutôt qu'imbriquées
 * pour que chaque onglet n'ait qu'à nommer la sienne, et pour qu'ajouter un
 * domaine reste une ligne dans ONGLETS.
 */

function SectionPopulation({ data }: { data: KpiResponse }) {
  return (
    <>
    {/* Section — Utilisateurs */}
    <section className="space-y-4">
      <SectionHeader
        icon={Users}
        title="Utilisateurs"
        description="Population totale inscrite sur la période"
        accent="primary"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total inscrits" value={data.utilisateurs.total} icon={Users} accent="primary" />
        <StatCard
          label="Professeurs / Enseignants"
          value={data.utilisateurs.professeurs ?? 0}
          icon={GraduationCap}
          accent="sky"
          base={data.utilisateurs.total}
        />
        <StatCard
          label="Autres rôles"
          value={data.utilisateurs.autres ?? 0}
          icon={UserCircle}
          accent="amber"
          base={data.utilisateurs.total}
        />
        <StatCard label="Connectés sur la période" value={data.utilisateurs.connectes} icon={LogIn} accent="emerald" base={data.utilisateurs.total} baseLabel="taux de connexion" />
        <StatCard label="Femmes" value={data.utilisateurs.femmes} icon={UserCircle} accent="rose" base={data.utilisateurs.total} />
        <StatCard label="Femmes de 35 ans ou moins" value={data.utilisateurs.femmes_35_max} icon={UserCircle} accent="rose" base={data.utilisateurs.total} />
        <StatCard label="En zone rurale" value={data.utilisateurs.zone_rurale} icon={MapPin} accent="emerald" base={data.utilisateurs.total} />
        <StatCard label="En situation de handicap" value={data.utilisateurs.situation_handicap} icon={Accessibility} accent="amber" base={data.utilisateurs.total} />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <div className="rounded-lg bg-sky-500/10 p-2 text-sky-600">
            <Cake className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">
              Répartition par tranche d'âge — Utilisateurs
            </CardTitle>
            <CardDescription>
              Toutes les tranches d'âge inscrites sur la période
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "< 18 ans", value: data.utilisateurs.age_ranges?.moins_18 ?? 0 },
            { label: "18 - 25 ans", value: data.utilisateurs.age_ranges?.de_18_25 ?? 0 },
            { label: "26 - 35 ans", value: data.utilisateurs.age_ranges?.de_26_35 ?? 0 },
            { label: "> 35 ans", value: data.utilisateurs.age_ranges?.plus_35 ?? 0 },
          ].map((bucket) => {
            const pct =
              data.utilisateurs.total > 0
                ? Math.min(100, Math.round((bucket.value / data.utilisateurs.total) * 100))
                : null;
            return (
              <div key={bucket.label} className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium text-muted-foreground">{bucket.label}</p>
                <p className="mt-1.5 text-3xl font-bold tabular-nums text-card-foreground">
                  {nf(bucket.value)}
                </p>
                {pct !== null && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>des utilisateurs</span>
                      <span className="font-semibold text-foreground">{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>

    {/* Section — Apprenants */}
    <section className="space-y-4">
      <SectionHeader
        icon={GraduationCap}
        title="Apprenants"
        description="Inscription — utilisateurs au rôle étudiant"
        accent="violet"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Apprenants inscrits" value={data.apprenants.total} icon={UserCheck} accent="violet" />
        <StatCard label="Âgés de 35 ans ou moins" value={data.apprenants.age_35_max} icon={Cake} accent="sky" base={data.apprenants.total} />
        <StatCard label="Femmes de 35 ans ou moins" value={data.apprenants.age_35_max_femmes} icon={UserCircle} accent="rose" base={data.apprenants.total} />
        <StatCard label="Femmes" value={data.apprenants.femmes} icon={UserCircle} accent="rose" base={data.apprenants.total} />
        <StatCard label="En zone rurale" value={data.apprenants.zone_rurale} icon={MapPin} accent="emerald" base={data.apprenants.total} />
        <StatCard label="En situation de handicap" value={data.apprenants.situation_handicap} icon={Accessibility} accent="amber" base={data.apprenants.total} />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <div className="rounded-lg bg-violet-500/10 p-2 text-violet-600">
            <Cake className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">
              Répartition par tranche d'âge — Apprenants
            </CardTitle>
            <CardDescription>
              Étudiants par tranche d'âge inscrits sur la période
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "< 18 ans", value: data.apprenants.age_ranges?.moins_18 ?? 0 },
            { label: "18 - 25 ans", value: data.apprenants.age_ranges?.de_18_25 ?? 0 },
            { label: "26 - 35 ans", value: data.apprenants.age_ranges?.de_26_35 ?? 0 },
            { label: "> 35 ans", value: data.apprenants.age_ranges?.plus_35 ?? 0 },
          ].map((bucket) => {
            const pct =
              data.apprenants.total > 0
                ? Math.min(100, Math.round((bucket.value / data.apprenants.total) * 100))
                : null;
            return (
              <div key={bucket.label} className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium text-muted-foreground">{bucket.label}</p>
                <p className="mt-1.5 text-3xl font-bold tabular-nums text-card-foreground">
                  {nf(bucket.value)}
                </p>
                {pct !== null && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>des apprenants</span>
                      <span className="font-semibold text-foreground">{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
    </>
  );
}

function SectionEngagement({ data }: { data: KpiResponse }) {
  return (
    <>
    {/* Section — Engagement */}
    <section className="space-y-4">
      <SectionHeader
        icon={Activity}
        title="Engagement"
        description="Connexion & consultation de ressources par les apprenants"
        accent="amber"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Apprenants actifs (30 j)"
          value={data.engagement.apprenants_actifs ?? 0}
          icon={Zap}
          accent="amber"
          base={data.apprenants.total}
          baseLabel="des apprenants"
        />
        <StatCard
          label="Apprenants connectés sur la période"
          value={data.engagement.apprenants_connectes}
          icon={LogIn}
          accent="emerald"
          base={data.apprenants.total}
          baseLabel="des apprenants"
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">
              Apprenants ayant consulté une ressource académique
            </CardTitle>
            <CardDescription>
              Épreuve ou concours — apprenants distincts, fenêtres glissantes
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Dernière semaine", value: data.engagement.apprenants_ressource.semaine },
            { label: "Dernières 2 semaines", value: data.engagement.apprenants_ressource.deux_semaines },
            { label: "Dernier mois", value: data.engagement.apprenants_ressource.mois },
          ].map((w) => {
            const pct =
              data.apprenants.total > 0
                ? Math.min(100, Math.round((w.value / data.apprenants.total) * 100))
                : null;
            return (
              <div key={w.label} className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium text-muted-foreground">{w.label}</p>
                <p className="mt-1.5 text-3xl font-bold tabular-nums text-card-foreground">
                  {nf(w.value)}
                </p>
                {pct !== null && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>des apprenants</span>
                      <span className="font-semibold text-foreground">{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
    </>
  );
}

function SectionAudience({ data }: { data: KpiResponse }) {
  const maxVues = Math.max(1, ...data.audience.modules.map((m) => m.vues));

  return (
    <>
      {/* Section — Audience par module */}
      <section className="space-y-4">
        <SectionHeader
          icon={Eye}
          title="Audience par module"
          description="Ce que les utilisateurs sont allés consulter, hors ressources académiques"
          accent="sky"
        />
        <DepuisQuand
          depuis={data.journaux.audience_modules_depuis}
          quoi="Le suivi des consultations de fiches"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <HeroTile
            label="Consultations"
            value={data.audience.total_vues}
            icon={Eye}
            accent="sky"
            sub="toutes fiches confondues"
          />
          <HeroTile
            label="Utilisateurs concernés"
            value={data.audience.utilisateurs_distincts}
            icon={Users}
            accent="primary"
            sub="distincts, sans double compte"
          />
        </div>

        {data.audience.opportunites && (
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
              <div className="rounded-lg bg-sky-500/10 p-2 text-sky-600">
                <Lightbulb className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Détail Opportunités : Bourses & Stages
                </CardTitle>
                <CardDescription>
                  Consultations et utilisateurs uniques par sous-type d'opportunité
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-semibold text-foreground">Bourses</p>
                <div className="flex items-baseline gap-4">
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-card-foreground">
                      {nf(data.audience.opportunites.bourses.vues)}
                    </p>
                    <p className="text-xs text-muted-foreground">consultations</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-card-foreground">
                      {nf(data.audience.opportunites.bourses.utilisateurs)}
                    </p>
                    <p className="text-xs text-muted-foreground">utilisateurs distincts</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-semibold text-foreground">Stages</p>
                <div className="flex items-baseline gap-4">
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-card-foreground">
                      {nf(data.audience.opportunites.stages.vues)}
                    </p>
                    <p className="text-xs text-muted-foreground">consultations</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-card-foreground">
                      {nf(data.audience.opportunites.stages.utilisateurs)}
                    </p>
                    <p className="text-xs text-muted-foreground">utilisateurs distincts</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.audience.modules.map((m) => (
            <CarteModule key={m.type} module={m} maxVues={maxVues} />
          ))}
        </div>
      </section>

    </>
  );
}

function SectionContenu({ data }: { data: KpiResponse }) {
  return (
    <>
      {/* Section — Offre de contenu */}
      <section className="space-y-4">
        <SectionHeader
          icon={BarChart3}
          title="Offre de contenu"
          description="Ce qui a été publié sur la période — le dénominateur de l'audience"
          accent="violet"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.contenu.map((c) => {
            const audience = data.audience.modules.find((m) => m.type === c.type);
            return (
              <StatCard
                key={c.type}
                label={c.libelle}
                value={c.publies}
                icon={ICONE_MODULE[c.type] ?? BarChart3}
                accent="violet"
                base={c.total}
                baseLabel={`sur ${nf(c.total)} au total${
                  audience ? ` · ${nf(audience.vues)} vues` : ""
                }`}
              />
            );
          })}
        </div>
      </section>

    </>
  );
}

function SectionCommunaute({ data }: { data: KpiResponse }) {
  return (
    <>
      {/* Section — Communauté */}
      <section className="space-y-4">
        <SectionHeader
          icon={MessagesSquare}
          title="Communauté"
          description="Forums, commentaires et likes sur la période"
          accent="emerald"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Forums ouverts" value={data.communaute.forums_ouverts} icon={MessagesSquare} accent="emerald" />
          <StatCard label="Commentaires postés" value={data.communaute.commentaires} icon={MessageSquare} accent="emerald" />
          <StatCard label="Commentateurs distincts" value={data.communaute.commentateurs} icon={Users} accent="primary" />
          <StatCard label="Likes" value={data.communaute.likes} icon={Heart} accent="rose" />
          <StatCard label="Utilisateurs ayant liké" value={data.communaute.likeurs} icon={Users} accent="rose" />
        </div>
      </section>

    </>
  );
}

function SectionJobKia({ data }: { data: KpiResponse }) {
  return (
    <>
      {/* Section — JobKia */}
      <section className="space-y-4">
        <SectionHeader
          icon={Briefcase}
          title="JobKia"
          description="Le côté offre de la place de marché — inscrits et publications sur la période"
          accent="amber"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Prestataires inscrits"
            value={data.jobkia.prestataires_inscrits}
            icon={UserCheck}
            accent="amber"
            base={data.jobkia.prestataires_total}
            baseLabel={`sur ${nf(data.jobkia.prestataires_total)} au total`}
          />
          <StatCard
            label="Recruteurs inscrits"
            value={data.jobkia.recruteurs_inscrits}
            icon={UserCircle}
            accent="amber"
            base={data.jobkia.recruteurs_total}
            baseLabel={`sur ${nf(data.jobkia.recruteurs_total)} au total`}
          />
          <StatCard label="Services publiés" value={data.jobkia.services_publies} icon={Wrench} accent="sky" />
          <StatCard label="Offres publiées" value={data.jobkia.offres_publiees} icon={Briefcase} accent="sky" />
          <StatCard label="Avis déposés" value={data.jobkia.avis_deposes} icon={MessageSquare} accent="violet" />
        </div>
      </section>

    </>
  );
}

function SectionCroissance({ data }: { data: KpiResponse }) {
  return (
    <>
      {/* Section — Croissance */}
      <section className="space-y-4">
        <SectionHeader
          icon={TrendingUp}
          title="Croissance"
          description="Activation, fidélité et monétisation — les chiffres qu'un investisseur regarde"
          accent="primary"
        />
        <DepuisQuand
          depuis={data.journaux.connexions_depuis}
          quoi="Le journal des connexions, qui porte l'activation et la rétention,"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Activation"
            value={data.croissance.activation.actives}
            icon={Zap}
            accent="emerald"
            base={data.croissance.activation.cohorte}
            baseLabel={`des ${nf(data.croissance.activation.cohorte)} inscrits se sont connectés`}
          />
          <StatCard label="Utilisateurs actifs (7 j)" value={data.croissance.assiduite.wau} icon={Activity} accent="amber" />
          <StatCard label="Utilisateurs actifs (30 j)" value={data.croissance.assiduite.mau} icon={Activity} accent="amber" />
          <StatCard
            label="Portefeuilles ouverts"
            value={data.croissance.monetisation.portefeuilles}
            icon={Wallet}
            accent="violet"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="shadow-sm">
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium text-muted-foreground">Rétention après inscription</p>
              <div className="flex gap-6">
                {[
                  { label: "à 7 jours", value: data.croissance.retention.j7 },
                  { label: "à 30 jours", value: data.croissance.retention.j30 },
                ].map((r) => (
                  <div key={r.label}>
                    <p className="text-2xl font-bold tabular-nums text-card-foreground">{r.value}%</p>
                    <p className="text-xs text-muted-foreground">{r.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium text-muted-foreground">Assiduité</p>
              <p className="text-2xl font-bold tabular-nums text-card-foreground">
                {data.croissance.assiduite.collage}%
              </p>
              <p className="text-xs text-muted-foreground">
                des actifs du mois reviennent dans la semaine
              </p>
              <Progress value={data.croissance.assiduite.collage} className="h-1.5" />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium text-muted-foreground">Complétion moyenne du profil</p>
              <p className="text-2xl font-bold tabular-nums text-card-foreground">
                {data.croissance.profil.completion_moyenne}%
              </p>
              <p className="text-xs text-muted-foreground">
                sur {nf(data.croissance.profil.comptes)} comptes actifs
              </p>
              <Progress value={data.croissance.profil.completion_moyenne} className="h-1.5" />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium text-muted-foreground">Abonnements</p>
              <p className="text-2xl font-bold tabular-nums text-card-foreground">
                {nf(data.croissance.monetisation.abonnements_actifs)}
              </p>
              <p className="text-xs text-muted-foreground">
                actifs · {nf(data.croissance.monetisation.abonnements_souscrits)} souscrits sur la
                période
              </p>
              {data.croissance.monetisation.abonnements_actifs === 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  La souscription est livrée désactivée : ce zéro est un état, pas un échec
                  commercial.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Transactions de portefeuille"
            value={data.croissance.monetisation.transactions}
            icon={Repeat}
            accent="emerald"
          />
        </div>
      </section>
    </>
  );
}

/**
 * Les onglets de la page. L'ordre va du reporting bailleur — la démographie
 * d'inscription, qui existait seule jusqu'ici — vers ce que les gens font une
 * fois entrés, puis vers les chiffres de croissance.
 *
 * `cle` sert d'ancre dans l'URL : un rapport peut ainsi pointer un domaine
 * précis plutôt que le haut d'une page de huit sections.
 */
const ONGLETS: {
  cle: string;
  titre: string;
  icone: LucideIcon;
  rendu: (data: KpiResponse) => JSX.Element;
}[] = [
  { cle: "population",  titre: "Population",  icone: Users,          rendu: (d) => <SectionPopulation data={d} /> },
  { cle: "engagement",  titre: "Engagement",  icone: Activity,       rendu: (d) => <SectionEngagement data={d} /> },
  { cle: "modules",     titre: "Modules",     icone: Eye,            rendu: (d) => (
      <>
        <SectionAudience data={d} />
        <SectionContenu data={d} />
      </>
    ) },
  { cle: "communaute",  titre: "Communauté",  icone: MessagesSquare, rendu: (d) => <SectionCommunaute data={d} /> },
  { cle: "jobkia",      titre: "JobKia",      icone: Briefcase,      rendu: (d) => <SectionJobKia data={d} /> },
  { cle: "croissance",  titre: "Croissance",  icone: TrendingUp,     rendu: (d) => <SectionCroissance data={d} /> },
];

export default function Indicateurs() {
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  // L'onglet vit dans l'URL plutôt que dans un état local : un lien vers
  // « ?section=croissance » ouvre directement le bon domaine, et un retour
  // arrière du navigateur revient là où l'on était.
  const [params, setParams] = useSearchParams();
  const ongletDemande = params.get("section");
  const onglet = ONGLETS.some((o) => o.cle === ongletDemande)
    ? (ongletDemande as string)
    : ONGLETS[0].cle;

  // On inscrit l'onglet par défaut dans l'URL dès l'arrivée. Sans ça, un accès
  // à /indicateurs n'active aucune entrée du menu latéral, alors que le
  // contenu affiché est bien celui de la première section.
  useEffect(() => {
    if (ongletDemande !== onglet) {
      setParams(
        (p) => {
          p.set("section", onglet);
          return p;
        },
        { replace: true },
      );
    }
  }, [ongletDemande, onglet, setParams]);

  const country = localStorage.getItem("country") || "benin";
  const countryLabel = country.charAt(0).toUpperCase() + country.slice(1);

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["kpi", country, startDate, endDate],
    queryFn: () => kpiService.getKpis(startDate, endDate),
    enabled: !!startDate && !!endDate && startDate <= endDate,
    staleTime: 30000,
  });

  const activePreset = PRESETS.find(
    (p) => p.start() === startDate && endDate === defaultEnd(),
  )?.label;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Indicateurs
            </h1>
            <p className="text-muted-foreground">
              Suivi & reporting —{" "}
              <span className="font-medium text-foreground">{countryLabel}</span> ·
              du {startDate} au {endDate}
            </p>
          </div>
        </div>
        {isFetching && !isLoading && (
          <span className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Actualisation…
          </span>
        )}
      </div>

      {/* Date-range controls */}
      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="kpi-start">Date de début</Label>
            <Input
              id="kpi-start"
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kpi-end">Date de fin</Label>
            <Input
              id="kpi-end"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant={activePreset === p.label ? "default" : "outline"}
                onClick={() => {
                  setStartDate(p.start());
                  setEndDate(defaultEnd());
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {startDate > endDate && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          La date de début doit précéder la date de fin.
        </p>
      )}
      {isError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          Impossible de charger les indicateurs. Réessayez.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-8">
          <CardSkeletonGrid count={4} />
          <CardSkeletonGrid count={7} />
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Hero summary strip */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <HeroTile
              label="Utilisateurs inscrits"
              value={data.utilisateurs.total}
              icon={Users}
              accent="primary"
              sub="sur la période"
            />
            <HeroTile
              label="Apprenants inscrits"
              value={data.apprenants.total}
              icon={GraduationCap}
              accent="violet"
              sub="rôle étudiant"
            />
            <HeroTile
              label="Utilisateurs connectés"
              value={data.utilisateurs.connectes}
              icon={LogIn}
              accent="emerald"
              sub="au moins une connexion"
            />
            <HeroTile
              label="Apprenants actifs"
              value={data.engagement.apprenants_actifs ?? 0}
              icon={Zap}
              accent="amber"
              sub="connectés ou ressource · 30 j"
            />
          </div>

          {/* Le bandeau ci-dessus reste visible quel que soit l'onglet : ce sont
              les quatre chiffres qu'on ne veut pas avoir à retrouver. */}
          <Tabs
            value={onglet}
            onValueChange={(v) =>
              setParams(
                (p) => {
                  p.set("section", v);
                  return p;
                },
                { replace: true },
              )
            }
            className="space-y-6"
          >
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
              {ONGLETS.map((o) => {
                const Icone = o.icone;
                return (
                  <TabsTrigger key={o.cle} value={o.cle} className="gap-2">
                    <Icone className="h-4 w-4" />
                    {o.titre}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {ONGLETS.map((o) => (
              <TabsContent key={o.cle} value={o.cle} className="space-y-8">
                {o.rendu(data)}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      ) : null}
    </div>
  );
}
