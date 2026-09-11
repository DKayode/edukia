import {
  LayoutDashboard,
  GraduationCap,
  Building2,
  GitFork,
  Layers,
  BookMarked,
  FileText,
  List,
  Building,
  Award,
  MessageCircle,
  MessagesSquare,
  Route,
  MessageSquare,
  Tags,
  Briefcase,
  Wrench,
  UserCheck,
  UserCog,
  Star,
  Cog,
  Megaphone,
  CalendarDays,
  Lightbulb,
  Settings,
  User,
  Users,
  BarChart3,
  SlidersHorizontal,
  UserPlus,
  Contact,
  Bell,
  Smartphone,
  ChevronRight,
  BookOpen,
  ClipboardCheck,
  Wallet,
  Banknote,
  Map,
  MapPin,
  ClipboardList,
  Sparkles,
  ScanText,
  CreditCard,
  Tag,
  Gauge,
  Lock,
  HandCoins,
  Trophy,
  Ticket,
  type LucideIcon,
  Activity,
  Eye,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useApp } from "@/hooks/useApp";
import { cn } from "@/lib/utils";

// A nav entry is either a leaf (route, or disabled "à venir") or a group with
// children. Groups may nest one level (Concours sits under Éducation).
interface NavItem {
  title: string;
  icon: LucideIcon;
  url?: string;
  badge?: string;
  children?: NavItem[];
}

const navTree: NavItem[] = [
  { title: "Tableau de bord", icon: LayoutDashboard, url: "/" },
  {
    title: "Éducation",
    icon: GraduationCap,
    children: [
      { title: "Établissements", icon: Building2, url: "/etablissements" },
      { title: "Filières", icon: GitFork, url: "/filieres" },
      { title: "Niveaux d'étude", icon: Layers, url: "/niveaux" },
      { title: "Matières", icon: BookMarked, url: "/matieres" },
      { title: "Épreuves", icon: FileText, url: "/epreuves" },
      {
        title: "Examens Nat.",
        icon: GraduationCap,
        children: [
          { title: "Examens Nat.", icon: FileText, url: "/examens-nationaux" },
          { title: "Types d'examen", icon: List, url: "/types-examen" },
          { title: "Séries", icon: Layers, url: "/series-examen" },
          { title: "Matières", icon: BookMarked, url: "/matieres-examen" },
          { title: "Filières", icon: BookMarked, url: "/filieres-examen" },
        ],
      },
      {
        title: "Concours",
        icon: GraduationCap,
        children: [
          { title: "Concours", icon: List, url: "/concours" },
          { title: "Vue groupée", icon: Layers, url: "/concours/groupes" },
          { title: "Structures", icon: Building, url: "/structures" },
          { title: "Titres", icon: Award, url: "/titres" },
        ],
      },
    ],
  },
  {
    // Ketsia est le nom public de l'assistante ; le code, lui, parle toujours
    // de Kessiah — renommer les modules aurait cassé l'intégration pour un
    // gain nul, l'utilisateur ne lisant que ces libellés.
    title: "Ketsia",
    icon: Sparkles,
    children: [
      { title: "Lectures d'épreuves", icon: ScanText, url: "/ketsia/transcriptions" },
    ],
  },
  {
    title: "Abonnements",
    icon: CreditCard,
    children: [
      { title: "Abonnements", icon: CreditCard, url: "/admin/abonnements" },
      { title: "Plans", icon: Tag, url: "/admin/abonnements/plans" },
      { title: "Quotas gratuits", icon: Gauge, url: "/admin/abonnements/quotas" },
      // Placé juste après les réglages qu'il rend effectifs : c'est le seul
      // interrupteur qui refuse réellement un accès.
      { title: "Verrou d'accès", icon: Lock, url: "/admin/abonnements/verrou" },
      { title: "Complétion du profil", icon: ClipboardCheck, url: "/admin/abonnements/completion-profil" },
      { title: "Commission parrainage", icon: HandCoins, url: "/admin/abonnements/commission" },
      { title: "Classement commissions", icon: Trophy, url: "/admin/abonnements/classement-commissions" },
      { title: "Codes & réductions", icon: Ticket, url: "/admin/codes" },
      { title: "Paiements entrants", icon: CreditCard, url: "/admin/abonnements/paiements" },
    ],
  },
  {
    title: "Approbations",
    icon: UserCheck,
    children: [
      { title: "Épreuves en attente", icon: FileText, url: "/approbations/epreuves" },
      { title: "Concours en attente", icon: FileText, url: "/approbations/concours" },
      { title: "Examens Nat. en attente", icon: FileText, url: "/approbations/examens-nationaux" },
      { title: "Statistiques", icon: BarChart3, url: "/statistiques-approbations" },
      {
        title: "Wallet",
        icon: Wallet,
        children: [
          { title: "Retraits", icon: Banknote, url: "/admin/retraits" },
          { title: "Configuration", icon: SlidersHorizontal, url: "/admin/wallet-configuration" },
        ],
      },
    ],
  },
  {
    title: "Communauté",
    icon: MessageCircle,
    children: [
      { title: "Forums", icon: MessagesSquare, url: "/forums" },
      {
        title: "Parcours",
        icon: Route,
        children: [
          { title: "Parcours", icon: Route, url: "/parcours" },
          { title: "Catégories", icon: Tags, url: "/categories" },
        ],
      },
      { title: "Commentaires", icon: MessageSquare },
    ],
  },
  {
    title: "JobKia",
    icon: Briefcase,
    children: [
      { title: "Services", icon: Wrench, url: "/admin/services" },
      { title: "Offres", icon: Briefcase, url: "/admin/offres" },
      { title: "Prestataires", icon: UserCheck },
      { title: "Recruteurs", icon: UserCog, url: "/admin/recruteurs" },
      { title: "Avis", icon: Star },
      { title: "Types (Services, Offres)", icon: Layers, url: "/admin/service-types" },
      { title: "Compétences", icon: Cog, url: "/admin/competences" },
    ],
  },
  {
    title: "Enquêtes",
    icon: ClipboardList,
    children: [
      { title: "Campagnes", icon: ClipboardList, url: "/enquetes" },
    ],
  },
  {
    title: "Contenu",
    icon: Megaphone,
    children: [
      { title: "Publicités", icon: Megaphone, url: "/publicites" },
      { title: "Événements", icon: CalendarDays, url: "/evenements" },
      { title: "Opportunités", icon: Lightbulb, url: "/opportunites" },
    ],
  },
  {
    title: "Utilisateurs",
    icon: Users,
    children: [
      { title: "Utilisateurs", icon: User, url: "/users" },
      {
        // Les six domaines d'indicateurs. Chaque entrée ouvre directement son
        // onglet ; sans elles, sept sections sur huit restaient invisibles
        // depuis le menu.
        title: "Indicateurs",
        icon: BarChart3,
        children: [
          { title: "Population", icon: Users, url: "/indicateurs?section=population" },
          { title: "Engagement", icon: Activity, url: "/indicateurs?section=engagement" },
          { title: "Modules", icon: Eye, url: "/indicateurs?section=modules" },
          { title: "Communauté", icon: MessagesSquare, url: "/indicateurs?section=communaute" },
          { title: "JobKia", icon: Briefcase, url: "/indicateurs?section=jobkia" },
          { title: "Croissance", icon: TrendingUp, url: "/indicateurs?section=croissance" },
        ],
      },
      { title: "Parrainage", icon: UserPlus, url: "/parrainages" },
      { title: "Appareils partagés", icon: Smartphone, url: "/appareils-partages" },
      {
        // geo-profile: Géographie subgroup, nested under Utilisateurs
        title: "Géographie",
        icon: Map,
        children: [
          { title: "Départements", icon: MapPin, url: "/departements" },
          { title: "Villes", icon: MapPin, url: "/villes" },
        ],
      },
    ],
  },
  {
    title: "Personnalisation",
    icon: UserCog,
    children: [
      { title: "Types de profil", icon: Tags, url: "/types-profil" },
      { title: "Associations audience", icon: Tags, url: "/types-profil/associations" },
    ],
  },
  {
    title: "Système",
    icon: Settings,
    children: [
      { title: "Paramètres", icon: SlidersHorizontal },
      { title: "Contacts Pro", icon: Contact, url: "/contacts-professionnels" },
      { title: "Notifications", icon: Bell, url: "/notifications" },
      { title: "Versions App", icon: Smartphone, url: "/app-versions" },
    ],
  },
];

const collectUrls = (item: NavItem): string[] =>
  item.children ? item.children.flatMap(collectUrls) : item.url ? [item.url] : [];

/**
 * Un lien est actif quand son chemin correspond. Les entrées qui portent une
 * ancre de section — `/indicateurs?section=modules` — se comparent en revanche
 * sur l'URL entière : sans quoi les six sous-sections des Indicateurs
 * paraîtraient actives toutes en même temps.
 */
const estActif = (url: string | undefined, urlCourante: string) => {
  if (!url) return false;
  const [chemin] = urlCourante.split("?");
  return url.includes("?") ? url === urlCourante : url === chemin;
};

const containsPath = (item: NavItem, urlCourante: string) =>
  collectUrls(item).some((url) => estActif(url, urlCourante));

function SubLeaf({ item, currentUrl }: { item: NavItem; currentUrl: string }) {
  if (!item.url) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild>
          <span aria-disabled className="cursor-default">
            <item.icon className="h-3.5 w-3.5" />
            <span>{item.title}</span>
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              à venir
            </span>
          </span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={estActif(item.url, currentUrl)}>
        <NavLink to={item.url} end>
          <item.icon className="h-3.5 w-3.5" />
          <span>{item.title}</span>
          {item.badge && (
            <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
              {item.badge}
            </span>
          )}
        </NavLink>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

// Second-level collapsible group (e.g. Concours), rendered inside a SidebarMenuSub.
function SubGroup({ item, currentUrl }: { item: NavItem; currentUrl: string }) {
  const hasActive = useMemo(() => containsPath(item, currentUrl), [item, currentUrl]);
  const [open, setOpen] = useState(hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <SidebarMenuSubItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton asChild>
            <button type="button" className="w-full">
              <item.icon className="h-3.5 w-3.5" />
              <span>{item.title}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">
                  {item.children?.length}
                </span>
                <ChevronRight
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
                />
              </span>
            </button>
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children?.map((child) => (
              <SubLeaf key={child.title} item={child} currentUrl={currentUrl} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
  );
}

// Top-level collapsible group.
function TopGroup({ item, currentUrl }: { item: NavItem; currentUrl: string }) {
  const hasActive = useMemo(() => containsPath(item, currentUrl), [item, currentUrl]);
  const [open, setOpen] = useState(hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} className="font-medium">
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">
                {item.children?.length}
              </span>
              <ChevronRight
                className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
              />
            </span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children?.map((child) =>
              child.children ? (
                <SubGroup key={child.title} item={child} currentUrl={currentUrl} />
              ) : (
                <SubLeaf key={child.title} item={child} currentUrl={currentUrl} />
              ),
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  // Chemin ET paramètres : les sous-sections des Indicateurs ne se
  // distinguent que par leur `?section=`.
  const currentUrl = location.pathname + location.search;
  const { data: app } = useApp();

  const brandName = app?.name ?? "Admin Panel";
  const Logo = () =>
    app?.logo ? (
      <img src={app.logo} alt={brandName} className="h-5 w-5 object-contain" />
    ) : (
      <BookOpen className="h-5 w-5 text-sidebar-primary-foreground" />
    );

  return (
    <Sidebar className={state === "collapsed" ? "w-14" : "w-64"} collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        {state !== "collapsed" && (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary overflow-hidden">
              <Logo />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-sidebar-foreground">{brandName}</h2>
              <p className="text-xs text-sidebar-foreground/60">Console d'administration</p>
            </div>
          </div>
        )}
        {state === "collapsed" && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary overflow-hidden">
            <Logo />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navTree.map((item) =>
                item.children ? (
                  <TopGroup key={item.title} item={item} currentUrl={currentUrl} />
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={estActif(item.url, currentUrl)}
                      tooltip={item.title}
                    >
                      <NavLink
                        to={item.url!}
                        end
                        className="hover:bg-sidebar-accent/50"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
