import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { useFilloExtension } from "@/hooks/useFilloExtension";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import ProfileEdit from "./pages/ProfileEdit";
import Privacy from "./pages/Privacy";
import Pricing from "./pages/Pricing";

// The owner/admin dashboard is its own chunk: end users never download it.
const AdminLogin = lazy(() => import("./admin/AdminLogin"));
const AdminLayout = lazy(() => import("./admin/AdminLayout"));
const AdminOverview = lazy(() => import("./admin/pages/Overview"));
const AdminUsers = lazy(() => import("./admin/pages/Users"));
const AdminUserDetail = lazy(() => import("./admin/pages/UserDetail"));
const AdminQuality = lazy(() => import("./admin/pages/Quality"));
const AdminAudit = lazy(() => import("./admin/pages/Audit"));
const AdminSystem = lazy(() => import("./admin/pages/System"));
const AdminPlatform = lazy(() => import("./admin/pages/Platform"));
const AdminAdmins = lazy(() => import("./admin/pages/Admins"));

const queryClient = new QueryClient();

// Component to handle extension integration (must be inside AuthProvider)
function ExtensionIntegration() {
  useFilloExtension();
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ExtensionIntegration />
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile/edit/:id" element={<ProfileEdit />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/admin/login" element={<Suspense fallback={null}><AdminLogin /></Suspense>} />
            <Route path="/admin" element={<Suspense fallback={null}><AdminLayout /></Suspense>}>
              <Route index element={<Suspense fallback={null}><AdminOverview /></Suspense>} />
              <Route path="users" element={<Suspense fallback={null}><AdminUsers /></Suspense>} />
              <Route path="users/:id" element={<Suspense fallback={null}><AdminUserDetail /></Suspense>} />
              <Route path="quality" element={<Suspense fallback={null}><AdminQuality /></Suspense>} />
              <Route path="audit" element={<Suspense fallback={null}><AdminAudit /></Suspense>} />
              <Route path="system" element={<Suspense fallback={null}><AdminSystem /></Suspense>} />
              <Route path="platform" element={<Suspense fallback={null}><AdminPlatform /></Suspense>} />
              <Route path="admins" element={<Suspense fallback={null}><AdminAdmins /></Suspense>} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
