import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "@/lib/api";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import ServerDetail from "@/pages/ServerDetail";
import Analytics from "@/pages/Analytics";
import Alerts from "@/pages/Alerts";
import SettingsPage from "@/pages/Settings";
import UsersPage from "@/pages/Users";
import AuditLogsPage from "@/pages/AuditLogs";
import WhatsAppPage from "@/pages/WhatsApp";
import TerminalPage from "@/pages/Terminal";
import { useAuth } from "@/lib/auth";

function Protected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function BareProtected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { loading, isAdmin } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { loading, isSuperAdmin } = useAuth();
  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/servers/:id" element={<Protected><ServerDetail /></Protected>} />
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/alerts" element={<Protected><Alerts /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="/users" element={<Protected><AdminOnly><UsersPage /></AdminOnly></Protected>} />
      <Route path="/audit-logs" element={<Protected><AdminOnly><AuditLogsPage /></AdminOnly></Protected>} />
      <Route path="/whatsapp" element={<Protected><AdminOnly><WhatsAppPage /></AdminOnly></Protected>} />
      <Route path="/servers/:id/terminal" element={<BareProtected><SuperAdminOnly><TerminalPage /></SuperAdminOnly></BareProtected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}