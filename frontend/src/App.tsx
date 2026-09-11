import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DashboardLayout } from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import Etablissements from "./pages/Etablissements";
import Filieres from "./pages/Filieres";
import Matieres from "./pages/Matieres";
import Niveaux from "./pages/Niveaux";
import Epreuves from "./pages/Epreuves";
import Publicites from "./pages/Publicites";
import Evenements from "./pages/Evenements";
import Opportunites from "./pages/Opportunites";
import Concours from "./pages/Concours";
import ConcoursGrouped from "./pages/ConcoursGrouped";
import ConcoursAdmin from "./pages/ConcoursAdmin";
import ContactsProfessionnels from "./pages/ContactsProfessionnels";
import Parcours from "./pages/Parcours";
import Categories from "./pages/Categories";
import TypesProfil from "./pages/TypesProfil";
import TypeProfilAssociations from "./pages/TypeProfilAssociations";
import Structures from "./pages/Structures";
import Titres from "./pages/Titres";
import Departements from "./pages/Departements";
import Villes from "./pages/Villes";
import Settings from "./pages/Settings";
import ServicesAdmin from "./pages/ServicesAdmin";
import EpreuvesApprobation from "./pages/EpreuvesApprobation";
import KetsiaTranscriptions from "./pages/KetsiaTranscriptions";
import ExamensNationaux from "./pages/ExamensNationaux";
import ExamensNationauxApprobation from "./pages/ExamensNationauxApprobation";
import TypesExamen from "./pages/TypesExamen";
import SeriesExamen from "./pages/SeriesExamen";
import MatieresExamen from "./pages/MatieresExamen";
import FilieresExamen from "./pages/FilieresExamen";
import OffresAdmin from "./pages/OffresAdmin";
import ServiceTypesAdmin from "./pages/ServiceTypesAdmin";
import RecruteursAdmin from "./pages/RecruteursAdmin";
import CompetencesAdmin from "./pages/CompetencesAdmin";
import Notifications from "./pages/Notifications";
import AppVersions from "./pages/AppVersions";
import Parrainages from "./pages/Parrainages";
import AppareilsPartages from "./pages/AppareilsPartages";
import Indicateurs from "./pages/Indicateurs";
import StatistiquesApprobations from "./pages/StatistiquesApprobations";
import RetraitsWallet from "./pages/RetraitsWallet";
import ConfigurationWallet from "./pages/ConfigurationWallet";
import Abonnements from "./pages/Abonnements";
import PlansAbonnement from "./pages/PlansAbonnement";
import QuotasGratuits from "./pages/QuotasGratuits";
import VerrouAcces from "./pages/VerrouAcces";
import CompletionProfil from "./pages/CompletionProfil";
import CommissionParrainage from "./pages/CommissionParrainage";
import ClassementCommissions from "./pages/ClassementCommissions";
import Codes from "./pages/Codes";
import ConfigurationPaiements from "./pages/ConfigurationPaiements";
import EnquetesCampagnes from "./pages/EnquetesCampagnes";
import EnquetesBuilder from "./pages/EnquetesBuilder";
import EnquetesResultats from "./pages/EnquetesResultats";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import Forums from "./pages/Forums";
import Desabonnement from "./pages/Desabonnement";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/desabonnement" element={<Desabonnement />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/users" element={<Users />} />
                      <Route path="/etablissements" element={<Etablissements />} />
                      <Route path="/filieres" element={<Filieres />} />
                      <Route path="/matieres" element={<Matieres />} />
                      <Route path="/niveaux" element={<Niveaux />} />
                      <Route path="/epreuves" element={<Epreuves />} />
                      <Route path="/ketsia/transcriptions" element={<KetsiaTranscriptions />} />
                      <Route path="/approbations/epreuves" element={<EpreuvesApprobation />} />
                      <Route path="/publicites" element={<Publicites />} />
                      <Route path="/evenements" element={<Evenements />} />
                      <Route path="/opportunites" element={<Opportunites />} />
                      <Route path="/concours" element={<Concours />} />
                      <Route path="/concours/groupes" element={<ConcoursGrouped />} />
                      <Route path="/approbations/concours" element={<ConcoursAdmin />} />
                      <Route path="/examens-nationaux" element={<ExamensNationaux />} />
                      <Route path="/approbations/examens-nationaux" element={<ExamensNationauxApprobation />} />
                      <Route path="/types-examen" element={<TypesExamen />} />
                      <Route path="/series-examen" element={<SeriesExamen />} />
                      <Route path="/matieres-examen" element={<MatieresExamen />} />
                      <Route path="/filieres-examen" element={<FilieresExamen />} />
                      <Route path="/forums" element={<Forums />} />
                      <Route path="/parcours" element={<Parcours />} />
                      <Route path="/categories" element={<Categories />} />
                      <Route path="/types-profil" element={<TypesProfil />} />
                      <Route path="/types-profil/associations" element={<TypeProfilAssociations />} />
                      <Route path="/structures" element={<Structures />} />
                      <Route path="/titres" element={<Titres />} />
                      <Route path="/departements" element={<Departements />} />
                      <Route path="/villes" element={<Villes />} />
                      <Route path="/contacts-professionnels" element={<ContactsProfessionnels />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/notifications" element={<Notifications />} />
                      <Route path="/admin/services" element={<ServicesAdmin />} />
                      <Route path="/admin/offres" element={<OffresAdmin />} />
                      <Route path="/admin/service-types" element={<ServiceTypesAdmin />} />
                      <Route path="/app-versions" element={<AppVersions />} />
                      <Route path="/parrainages" element={<Parrainages />} />
                      <Route path="/appareils-partages" element={<AppareilsPartages />} />
                      <Route path="/admin/recruteurs" element={<RecruteursAdmin />} />
                      <Route path="/admin/competences" element={<CompetencesAdmin />} />
                      <Route path="/indicateurs" element={<Indicateurs />} />
                      <Route path="/statistiques-approbations" element={<StatistiquesApprobations />} />
                      <Route path="/admin/retraits" element={<RetraitsWallet />} />
                      <Route path="/admin/wallet-configuration" element={<ConfigurationWallet />} />
                      <Route path="/admin/abonnements" element={<Abonnements />} />
                      <Route path="/admin/abonnements/plans" element={<PlansAbonnement />} />
                      <Route path="/admin/abonnements/quotas" element={<QuotasGratuits />} />
                      <Route path="/admin/abonnements/verrou" element={<VerrouAcces />} />
                      <Route path="/admin/abonnements/completion-profil" element={<CompletionProfil />} />
                      <Route path="/admin/abonnements/commission" element={<CommissionParrainage />} />
                      <Route path="/admin/abonnements/classement-commissions" element={<ClassementCommissions />} />
                      <Route path="/admin/codes" element={<Codes />} />
                      <Route path="/admin/abonnements/paiements" element={<ConfigurationPaiements />} />
                      <Route path="/enquetes" element={<EnquetesCampagnes />} />
                      <Route path="/enquetes/nouveau" element={<EnquetesBuilder />} />
                      <Route path="/enquetes/:uuid/edition" element={<EnquetesBuilder />} />
                      <Route path="/enquetes/:uuid/resultats" element={<EnquetesResultats />} />
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
