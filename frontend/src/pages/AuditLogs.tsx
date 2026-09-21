import { useEffect, useState } from "react";
import {
  Building2,
  History,
  KeyRound,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  Settings2,
  Terminal,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { showToast } from "@/components/ToastHost";
import type { AuditAction, AuditLog } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatTime } from "@/lib/utils";

type FilterKey =
  | "all"
  | "access"
  | "terminal"
  | "config"
  | "templates"
  | "services"
  | "servers"
  | "sites"
  | "users"
  | "keys"
  | "connectivity";

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: "all", label: "All" },
  { id: "access", label: "Access" },
  { id: "terminal", label: "Terminal" },
  { id: "config", label: "Config" },
  { id: "templates", label: "Templates" },
  { id: "services", label: "Services" },
  { id: "servers", label: "Servers" },
  { id: "sites", label: "Sites" },
  { id: "users", label: "Users" },
  { id: "keys", label: "API keys" },
  { id: "connectivity", label: "Links" },
];

function actionFilter(log: AuditLog): FilterKey[] {
  const a = log.action;
  if (a === "login" || a === "logout" || a === "password_change" || a === "token_refresh") return ["access"];
  if (a === "terminal_command") return ["terminal"];
  if (a === "config_update" || a === "data_prune") return ["config"];
  if (a === "template_save" || a === "template_delete") return ["templates"];
  if (a === "service_add" || a === "service_update" || a === "service_remove") return ["services"];
  if (a === "server_create" || a === "server_update" || a === "server_delete") return ["servers"];
  if (a === "site_create" || a === "site_update" || a === "site_delete") return ["sites"];
  if (a === "user_create" || a === "user_update" || a === "user_delete") return ["users"];
  if (a === "api_key_create" || a === "api_key_revoke" || a === "api_key_delete") return ["keys"];
  if (a.startsWith("software_") || a.startsWith("deployment_")) return ["config"];
  if (a.startsWith("qa_")) return ["templates"];
  return ["connectivity"];
}

function auditSummary(log: AuditLog): string {
  const d = log.details ?? {};
  const str = (v: unknown) =>
    typeof v === "string" ? v : v == null ? "" : String(v).slice(0, 200);
  switch (log.action) {
    case "token_refresh":
      return "Refreshed dashboard session token";
    case "terminal_command":
      return `${d.server ?? d.server_id ?? ""} $ ${d.command ?? ""}`.trim();
    case "config_update":
      return [d.area, d.target, (d.keys ?? []).join(", ")].filter(Boolean).join(" · ");
    case "data_prune":
      return "manual retention prune";
    case "template_save":
    case "template_delete":
      return `${d.kind ?? "template"} "${d.name ?? ""}"`;
    case "service_add":
    case "service_update":
    case "service_remove":
      return `${d.service ?? ""}${d.port ? `:${d.port}` : ""} @ ${d.server ?? d.server_id ?? ""}${(d.keys ?? []).length ? ` (${(d.keys ?? []).join(", ")})` : ""}`.trim();
    case "server_create":
    case "server_update":
    case "server_delete":
      return `${d.server ?? d.name ?? d.server_id ?? ""}${(d.keys ?? []).length ? ` (${(d.keys ?? []).join(", ")})` : ""}`.trim();
    case "site_create":
    case "site_update":
    case "site_delete":
      return `${d.client ?? ""} ${d.code ?? ""}${(d.keys ?? []).length ? ` (${(d.keys ?? []).join(", ")})` : ""}`.trim();
    case "user_create":
    case "user_update":
    case "user_delete":
      return `${d.target ?? ""}${(d.keys ?? []).length ? ` (${(d.keys ?? []).join(", ")})` : ""}`.trim();
    case "api_key_create":
    case "api_key_revoke":
    case "api_key_delete":
      return `"${d.key_name ?? ""}" @ ${d.server ?? d.server_id ?? ""}`.trim();
    case "password_change":
      return "changed own password";
    case "connectivity_lost":
    case "connectivity_restored":
      return `${d.target ?? ""}${d.ip ? ` · ${d.ip}` : ""}`;
    default:
      return str(d.summary ?? "");
  }
}

function ActionBadge({ action }: { action: AuditAction }) {
  const base =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase";
  const conf: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    login: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", icon: <LogIn className="h-3 w-3" />, label: "Login" },
    logout: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-400", icon: <LogOut className="h-3 w-3" />, label: "Logout" },
    token_refresh: { cls: "border-sky-500/30 bg-sky-500/10 text-sky-400", icon: <RefreshCw className="h-3 w-3" />, label: "Session Refresh" },
    password_change: { cls: "border-violet-500/30 bg-violet-500/10 text-violet-300", icon: <KeyRound className="h-3 w-3" />, label: "Password" },
    terminal_command: { cls: "border-purple-500/30 bg-purple-500/10 text-purple-300", icon: <Terminal className="h-3 w-3" />, label: "Terminal" },
    config_update: { cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <Settings2 className="h-3 w-3" />, label: "Config" },
    data_prune: { cls: "border-orange-500/30 bg-orange-500/10 text-orange-300", icon: <Trash2 className="h-3 w-3" />, label: "Prune" },
    template_save: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <Plus className="h-3 w-3" />, label: "Tpl save" },
    template_delete: { cls: "border-red-500/30 bg-red-500/10 text-red-300", icon: <Trash2 className="h-3 w-3" />, label: "Tpl del" },
    service_add: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <Plus className="h-3 w-3" />, label: "Svc add" },
    service_update: { cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <Pencil className="h-3 w-3" />, label: "Svc edit" },
    service_remove: { cls: "border-red-500/30 bg-red-500/10 text-red-300", icon: <Trash2 className="h-3 w-3" />, label: "Svc del" },
    server_create: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <ServerIcon className="h-3 w-3" />, label: "Srv add" },
    server_update: { cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <ServerIcon className="h-3 w-3" />, label: "Srv edit" },
    server_delete: { cls: "border-red-500/30 bg-red-500/10 text-red-300", icon: <ServerIcon className="h-3 w-3" />, label: "Srv del" },
    site_create: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <Building2 className="h-3 w-3" />, label: "Site add" },
    site_update: { cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <Building2 className="h-3 w-3" />, label: "Site edit" },
    site_delete: { cls: "border-red-500/30 bg-red-500/10 text-red-300", icon: <Building2 className="h-3 w-3" />, label: "Site del" },
    user_create: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <Users className="h-3 w-3" />, label: "User add" },
    user_update: { cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <Users className="h-3 w-3" />, label: "User edit" },
    user_delete: { cls: "border-red-500/30 bg-red-500/10 text-red-300", icon: <Users className="h-3 w-3" />, label: "User del" },
    api_key_create: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <KeyRound className="h-3 w-3" />, label: "Key add" },
    api_key_revoke: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: <KeyRound className="h-3 w-3" />, label: "Key revoke" },
    api_key_delete: { cls: "border-red-500/30 bg-red-500/10 text-red-300", icon: <KeyRound className="h-3 w-3" />, label: "Key del" },
    connectivity_lost: { cls: "border-red-500/30 bg-red-500/10 text-red-400", icon: <WifiOff className="h-3 w-3" />, label: "Link lost" },
    connectivity_restored: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", icon: <Wifi className="h-3 w-3" />, label: "Reconnected" },
  };
  const c = conf[action] ?? { cls: "border-slate-500/30 bg-slate-500/10 text-slate-300", icon: null, label: action };
  return (
    <span className={cn(base, c.cls)}>
      {c.icon} {c.label}
    </span>
  );
}

export default function AuditLogsPage() {
  const { isSuperAdmin } = useAuth();
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState<FilterKey>("all");

  function fetchAuditLogs() {
    setAuditLoading(true);
    apiFetch<AuditLog[]>("/users/audit-logs")
      .then(setAuditLogs)
      .catch((err) =>
        showToast({
          severity: "critical",
          title: "Failed to load audit logs",
          message: err instanceof Error ? err.message : undefined,
        })
      )
      .finally(() => setAuditLoading(false));
  }

  useEffect(() => {
    if (isSuperAdmin) {
      fetchAuditLogs();
    }
  }, [isSuperAdmin]);

  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchesAction =
      auditActionFilter === "all" || actionFilter(log).includes(auditActionFilter);
    const q = auditSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      log.email.toLowerCase().includes(q) ||
      auditSummary(log).toLowerCase().includes(q) ||
      (log.ip_address ?? "").toLowerCase().includes(q);
    return matchesAction && matchesSearch;
  });

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <h2 className="text-xl font-bold text-red-400">Access Restricted</h2>
        <p className="mt-1 text-sm text-slate-400">Audit logs are restricted to Super Admin accounts.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-slate-400">Who changed what, when — config changes, access and terminal execution (super admin only)</p>
      </div>

      <Card className="border-indigo-500/30 bg-slate-900/80">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <History className="h-4 w-4 text-indigo-400" />
              Activity History ({filteredAuditLogs.length})
            </CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">
              Newest first. Secrets (passwords, URIs, keys) are never stored here.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchAuditLogs}
            disabled={auditLoading}
            className="border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 text-xs h-8"
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", auditLoading && "animate-spin")} />
            Refresh Logs
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 pb-3">
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
              {FILTERS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAuditActionFilter(a.id)}
                  className={cn(
                    "rounded-md px-2.5 py-0.5 text-xs font-medium capitalize transition-all",
                    auditActionFilter === a.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter email, action detail, IP..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="h-7 w-64 rounded-lg border border-slate-700/60 bg-slate-950 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500/60"
              />
            </div>
          </div>

          {auditLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : filteredAuditLogs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No activity recorded yet.
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto pr-1">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="pb-2 font-medium">Who</th>
                    <th className="pb-2 font-medium">What</th>
                    <th className="pb-2 font-medium">When</th>
                    <th className="pb-2 text-right font-medium">Where (IP)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredAuditLogs.map((log) => {
                    const summary = auditSummary(log);
                    return (
                      <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 font-sans font-medium text-slate-200">
                          {log.email}
                        </td>
                        <td className="py-2.5">
                          <span className="flex flex-col items-start gap-1">
                            <ActionBadge action={log.action} />
                            {summary && (
                              <span className="max-w-72 truncate font-mono text-[11px] font-normal text-slate-400" title={summary}>
                                {summary}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-400 text-[11px] whitespace-nowrap">
                          {formatTime(log.timestamp)}
                        </td>
                        <td
                          className="py-2.5 text-right text-slate-400 text-[11px] font-mono"
                          title={log.user_agent}
                        >
                          {log.ip_address || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
