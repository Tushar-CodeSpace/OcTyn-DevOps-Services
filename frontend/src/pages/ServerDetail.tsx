import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, AlertTriangle, BarChart3, Bell, Building2, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Database, Download, FileSpreadsheet, FileText, Loader2, MapPin, MinusCircle, Pencil, Play, Plus, RefreshCw, Save, Search, Server as ServerIcon, ShieldAlert, ShieldCheck, ListChecks, Settings2, Terminal, TerminalSquare, Trash2, X, XCircle } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/socket";
import type { AgentConfig, AgentLog, AgentRuntimeTemplate, Alert, ApiKey, ConfigSnapshotFull, ConfigSnapshotMeta, ConnectivityStatus, CustomWidgetSpec, Metric, Server, Service, Site, WidgetHistoryPoint, WidgetSample, WidgetTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServiceBadge, StatusBadge, SeverityBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime, cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { showToast } from "@/components/ToastHost";

const RANGES = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
  { label: "30d", minutes: 43200 },
];

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {title}
      </h2>
      {sub && <p className="hidden text-[11px] text-slate-600 sm:block">{sub}</p>}
      <div className="h-px flex-1 bg-slate-800/70" />
    </div>
  );
}

function WidgetTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl">
      {label != null && label !== "" && (
        <p className="mb-1 font-mono text-[11px] text-slate-400">{label}</p>
      )}
      <div className="flex flex-col gap-0.5">
        {payload.map((p: any, i: number) => (
          <p key={i} className="flex items-center justify-between gap-4 text-slate-300">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: p.color || p.payload?.fill || "#94a3b8" }}
              />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="font-mono font-semibold">
              {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function Spark({
  id,
  data,
  dataKey,
  color,
}: {
  id: string;
  data: Record<string, string | number>[];
  dataKey: string;
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${id})`}
          fillOpacity={1}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [server, setServer] = useState<Server | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [snapMeta, setSnapMeta] = useState<ConfigSnapshotMeta[] | null>(null);
  const [expandedSnap, setExpandedSnap] = useState<string | null>(null);
  const [snapDocs, setSnapDocs] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingSnapDocs, setLoadingSnapDocs] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<{ rowId: string; database: string; collection: string } | null>(null);
  const [historyItems, setHistoryItems] = useState<ConfigSnapshotMeta[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [range, setRange] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [agentCfg, setAgentCfg] = useState<AgentConfig | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [agentCfgOpen, setAgentCfgOpen] = useState(false);
  const [connectivity, setConnectivity] = useState<ConnectivityStatus[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [newTargetName, setNewTargetName] = useState("");
  const [newTargetIp, setNewTargetIp] = useState("");
  const [dbType, setDbType] = useState<"mongo" | "postgres">("mongo");
  const [savingBackup, setSavingBackup] = useState(false);
  const [testingBackup, setTestingBackup] = useState(false);
  const [backupProgressText, setBackupProgressText] = useState<string | null>(null);
  const [backupCfgOpen, setBackupCfgOpen] = useState(false);

  // Services Management State
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServicePort, setNewServicePort] = useState("");
  const [addingService, setAddingService] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState("");
  const [editServicePort, setEditServicePort] = useState("");
  const [savingServiceEdit, setSavingServiceEdit] = useState(false);

  // Server edit state
  const [allSites, setAllSites] = useState<Site[]>([]);
  const [allServers, setAllServers] = useState<Server[]>([]);
  const [serverEditOpen, setServerEditOpen] = useState(false);
  const [editServerName, setEditServerName] = useState("");
  const [editServerHostname, setEditServerHostname] = useState("");
  const [editServerIp, setEditServerIp] = useState("");
  const [editServerSiteId, setEditServerSiteId] = useState("");
  const [savingServer, setSavingServer] = useState(false);

  // Tabbed layout + compact filter state (handy with many ports / backups / logs)
  const [activeTab, setActiveTab] = useState<"overview" | "services" | "backups" | "keys" | "logs">("overview");
  const [svcQuery, setSvcQuery] = useState("");
  const [svcStatus, setSvcStatus] = useState<"all" | "running" | "stopped" | "disabled">("all");
  const [svcPage, setSvcPage] = useState(0);
  const [backupQuery, setBackupQuery] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});

  // Logs Tab State (Site Slave Logs & Agent Runtime Logs)
  const [logsSubTab, setLogsSubTab] = useState<"site_slave_logs" | "agent_runtime">("site_slave_logs");
  const [siteAlerts, setSiteAlerts] = useState<Alert[]>([]);
  const [siteAlertsLoading, setSiteAlertsLoading] = useState(false);
  const [siteAlertsFilter, setSiteAlertsFilter] = useState<"active" | "resolved" | "all">("all");
  const [siteAlertsSeverity, setSiteAlertsSeverity] = useState<"all" | "critical" | "warning" | "info">("all");
  const [siteAlertsSearch, setSiteAlertsSearch] = useState("");
  const [siteAlertsScope, setSiteAlertsScope] = useState<"site" | "server">("site");
  const [agentLogsScope, setAgentLogsScope] = useState<"server" | "site">("server");

  // Agent Runtime Logs Tab State
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [agentLogTotal, setAgentLogTotal] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logLevel, setLogLevel] = useState<"all" | "info" | "warning" | "error">("all");
  const [logAutoRefresh, setLogAutoRefresh] = useState(true);
  const [fetchingJournal, setFetchingJournal] = useState(false);
  const [journalOutput, setJournalOutput] = useState<string | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);

  // Collapsible overview sections (null = auto: expand only when attention needed)
  const [healthOpen, setHealthOpen] = useState<boolean | null>(null);
  const [connOpen, setConnOpen] = useState<boolean | null>(null);
  const SVC_PAGE_SIZE = 10;

  // Custom data widgets (agent-pushed MongoDB tallies)
  const [widgets, setWidgets] = useState<WidgetSample[] | null>(null);
  const [triggeringWidgets, setTriggeringWidgets] = useState(false);
  const [widgetTemplates, setWidgetTemplates] = useState<WidgetTemplate[] | null>(null);

  const [refreshingWidgets, setRefreshingWidgets] = useState(false);
  const [runtimeTemplates, setRuntimeTemplates] = useState<AgentRuntimeTemplate[] | null>(null);
  const [runtimePick, setRuntimePick] = useState("");
  const [runtimeTplName, setRuntimeTplName] = useState("");

  // Load runtime templates whenever the Agent runtime modal opens
  useEffect(() => {
    if (!agentCfgOpen) return;
    setRuntimePick("");
    apiFetch<AgentRuntimeTemplate[]>("/agent-config-templates")
      .then(setRuntimeTemplates)
      .catch(() => setRuntimeTemplates([]));
  }, [agentCfgOpen]);
  // Default overview chart for all data widgets (bar/pie/trend), user preference
  type WidgetChartMode = "bar" | "pie" | "trend";
  const WIDGET_CHART_KEY = "octyn:widget-default-chart";
  const [defaultChart] = useState<WidgetChartMode>(() => {
    try {
      const v = localStorage.getItem(WIDGET_CHART_KEY);
      if (v === "bar" || v === "pie" || v === "trend") return v;
    } catch {
      /* private mode etc. */
    }
    return "bar";
  });
  const [widgetHistory, setWidgetHistory] = useState<Record<string, WidgetHistoryPoint[]>>({});
  const [loadingHist, setLoadingHist] = useState<Record<string, boolean>>({});

  // Prefetch trend histories whenever Trend is the default
  useEffect(() => {
    if (defaultChart !== "trend") return;
    for (const w of widgets ?? []) void loadWidgetHistory(w.widget_name);
  }, [defaultChart, widgets]);

  function exportMetricsCsv() {
    if (!metrics.length || !server) return;
    const headers = [
      "Timestamp",
      "CPU (%)",
      "Memory (%)",
      "Disk (%)",
      "Disk Read MB/s",
      "Disk Write MB/s",
      "Disk IOPS",
      "API Total Requests",
      "API 4xx Errors",
      "API 5xx Errors",
      "Uptime (s)",
    ];
    const rows = metrics.map((m) => [
      m.recorded_at,
      m.cpu_percent,
      m.memory_percent,
      m.disk_percent,
      m.disk_read_rate_mb ?? 0,
      m.disk_write_rate_mb ?? 0,
      m.disk_iops ?? 0,
      m.api_requests_total ?? 0,
      m.api_requests_4xx ?? 0,
      m.api_requests_5xx ?? 0,
      m.uptime_seconds,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${server.name}_metrics_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast({ severity: "info", title: "Metrics exported", message: "Downloaded metrics CSV report." });
  }

  async function loadMetrics() {
    if (!id) return;
    const m = await apiFetch<Metric[]>(`/metrics/servers/${id}?minutes=${range}`);
    setMetrics(m);
  }

  async function load() {
    if (!id) return;
    const [s, svc, k, sites, serverList] = await Promise.all([
      apiFetch<Server>(`/servers/${id}`),
      apiFetch<Service[]>(`/servers/${id}/services`),
      apiFetch<ApiKey[]>(`/servers/${id}/api-keys`),
      apiFetch<Site[]>("/sites"),
      apiFetch<Server[]>("/servers").catch(() => []),
    ]);
    setSite(sites.find((x) => x.id === s.site_id) ?? null);
    setAllSites(sites);
    setAllServers(serverList || []);
    setServer(s);
    setServices(svc);
    setKeys(k);
    apiFetch<Alert[]>(`/alerts?server_id=${id}&status=active&limit=20`)
      .then(setAlerts)
      .catch(() => setAlerts([]));
    apiFetch<{ total: number }>(`/servers/${id}/logs?limit=1`)
      .then((r) => setAgentLogTotal(r.total || 0))
      .catch(() => {});
    await loadMetrics();
  }

  async function loadAgentConfig() {
    if (!id) return;
    const cfg = await apiFetch<AgentConfig>(`/agent-config/${id}`).catch(() => null);
    if (cfg) setAgentCfg(cfg);
  }

  async function loadConnectivity() {
    if (!id) return;
    const res = await apiFetch<ConnectivityStatus[]>(`/servers/${id}/connectivity`).catch(
      () => null
    );
    if (res) setConnectivity(res);
  }

  const serverMap = useMemo(() => {
    return Object.fromEntries(allServers.map((srv) => [srv.id, srv]));
  }, [allServers]);

  const loadSiteAlerts = useCallback(async () => {
    if (!id) return;
    setSiteAlertsLoading(true);
    try {
      const params = new URLSearchParams();
      if (siteAlertsFilter !== "all") params.set("status", siteAlertsFilter);
      if (siteAlertsScope === "server") {
        params.set("server_id", id);
      } else if (server?.site_id) {
        params.set("site_id", server.site_id);
      } else {
        params.set("server_id", id);
      }
      params.set("limit", "500");
      const data = await apiFetch<Alert[]>(`/alerts?${params.toString()}`);
      setSiteAlerts(data || []);
    } catch (err) {
      console.error("Failed to load site slave logs:", err);
    } finally {
      setSiteAlertsLoading(false);
    }
  }, [id, server?.site_id, siteAlertsFilter, siteAlertsScope]);

  const loadAgentLogs = useCallback(async () => {
    if (!id) return;
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      if (logLevel !== "all") params.set("level", logLevel);
      if (logSearch.trim()) params.set("search", logSearch.trim());
      if (agentLogsScope === "site") params.set("scope", "site");
      params.set("limit", "300");
      const res = await apiFetch<{ server_id: string; total: number; logs: AgentLog[] }>(
        `/servers/${id}/logs?${params.toString()}`
      );
      setAgentLogs(res.logs || []);
      setAgentLogTotal(res.total || 0);
    } catch (err) {
      console.error("Failed to load agent logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  }, [id, logLevel, logSearch, agentLogsScope]);

  useEffect(() => {
    if (activeTab === "logs") {
      if (logsSubTab === "site_slave_logs") {
        loadSiteAlerts();
      } else {
        loadAgentLogs();
      }
    }
  }, [activeTab, logsSubTab, loadSiteAlerts, loadAgentLogs]);

  useEffect(() => {
    if (!logAutoRefresh || activeTab !== "logs" || logsSubTab !== "agent_runtime") return;
    const timer = setInterval(() => {
      loadAgentLogs();
    }, 5000);
    return () => clearInterval(timer);
  }, [logAutoRefresh, activeTab, logsSubTab, loadAgentLogs]);

  useEffect(() => {
    const socket = getSocket();
    const onNewLogs = (data: any) => {
      if (data && String(data.server_id) === String(id)) {
        if (activeTab === "logs" && logsSubTab === "agent_runtime") {
          loadAgentLogs();
        } else {
          setAgentLogTotal((prev) => prev + (data.logs?.length || 1));
        }
      }
    };
    const onAlertChange = () => {
      if (activeTab === "logs" && logsSubTab === "site_slave_logs") {
        loadSiteAlerts();
      }
    };
    socket.on("agent_logs", onNewLogs);
    socket.on("alert_opened", onAlertChange);
    socket.on("alert_resolved", onAlertChange);
    return () => {
      socket.off("agent_logs", onNewLogs);
      socket.off("alert_opened", onAlertChange);
      socket.off("alert_resolved", onAlertChange);
    };
  }, [id, activeTab, logsSubTab, loadAgentLogs, loadSiteAlerts]);

  const siteCriticalCount = siteAlerts.filter((a) => a.severity === "critical").length;
  const siteWarningCount = siteAlerts.filter((a) => a.severity === "warning").length;
  const siteActiveCount = siteAlerts.filter((a) => a.status === "active").length;
  const siteResolvedCount = siteAlerts.filter((a) => a.status === "resolved").length;

  const filteredSiteAlerts = useMemo(() => {
    return siteAlerts.filter((a) => {
      if (siteAlertsSeverity !== "all" && a.severity !== siteAlertsSeverity) return false;
      if (siteAlertsSearch.trim()) {
        const q = siteAlertsSearch.toLowerCase();
        const srv = serverMap[a.server_id] || (server?.id === a.server_id ? server : undefined);
        const match =
          a.message.toLowerCase().includes(q) ||
          a.type.toLowerCase().includes(q) ||
          (srv && (srv.name.toLowerCase().includes(q) || srv.hostname.toLowerCase().includes(q)));
        if (!match) return false;
      }
      return true;
    });
  }, [siteAlerts, siteAlertsSeverity, siteAlertsSearch, serverMap, server]);

  const handleFetchJournal = async () => {
    if (!id) return;
    setFetchingJournal(true);
    setJournalOpen(true);
    setJournalOutput("Queuing live journalctl inspection on remote agent host...");
    try {
      const res = await apiFetch<{ command_id: string; status: string }>(`/servers/${id}/logs/journal`, {
        method: "POST",
      });
      showToast({ severity: "info", title: "Journal Requested", message: "Inspecting live systemd journal on host..." });
      const cmdId = res.command_id;
      let finished = false;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 600));
        const statusRes = await apiFetch<any>(`/terminal/${id}/commands/${cmdId}`).catch(() => null);
        if (statusRes && statusRes.status && statusRes.status !== "queued" && statusRes.status !== "running") {
          setJournalOutput(statusRes.output || "No output returned from journalctl command.");
          finished = true;
          break;
        }
      }
      if (!finished) {
        setJournalOutput("Journalctl command queued on agent. Will complete once edge agent finishes execution.");
      }
    } catch (err: any) {
      setJournalOutput(`Failed to fetch journal: ${err?.message || "Unknown error"}`);
      showToast({ severity: "critical", title: "Journal Failed", message: err?.message || "Could not fetch journal" });
    } finally {
      setFetchingJournal(false);
    }
  };

  const handleClearLogs = async () => {
    if (!id) return;
    if (!window.confirm("Are you sure you want to clear stored agent logs for this server?")) return;
    try {
      await apiFetch(`/servers/${id}/logs`, { method: "DELETE" });
      setAgentLogs([]);
      setAgentLogTotal(0);
      showToast({ severity: "info", title: "Logs Cleared", message: "Agent logs cleared successfully" });
    } catch (err: any) {
      showToast({ severity: "critical", title: "Clear Failed", message: err?.message || "Could not clear logs" });
    }
  };

  async function saveAgentCfg() {
    if (!id || !agentCfg) return;
    setSavingCfg(true);
    try {
      const saved = await apiFetch<AgentConfig>(`/agent-config/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          monitoring_interval_seconds: agentCfg.monitoring_interval_seconds,
          http_timeout_seconds: agentCfg.http_timeout_seconds,
          http_retry_count: agentCfg.http_retry_count,
          config_poll_interval_seconds: agentCfg.config_poll_interval_seconds,
          connectivity_poll_interval_seconds: agentCfg.connectivity_poll_interval_seconds,
          connectivity_targets: agentCfg.connectivity_targets,
        }),
      });
      setAgentCfg(saved);
      showToast({
        severity: "info",
        title: "Agent runtime settings saved",
        message: "The agent will reflect this change within a few seconds.",
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Save failed",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSavingCfg(false);
    }
  }

  function applyRuntimeTemplate() {
    const t = runtimeTemplates?.find((x) => x.id === runtimePick);
    if (!t || !agentCfg) return;
    setAgentCfg({
      ...agentCfg,
      runtime_template_id: t.id,
      runtime_template_name: t.name,
      monitoring_interval_seconds: t.monitoring_interval_seconds,
      http_timeout_seconds: t.http_timeout_seconds,
      http_retry_count: t.http_retry_count,
      config_poll_interval_seconds: t.config_poll_interval_seconds,
      connectivity_poll_interval_seconds: t.connectivity_poll_interval_seconds,
      connectivity_targets: t.connectivity_targets.map((x) => ({ ...x })),
    });
    showToast({ severity: "info", title: "Template applied", message: `"${t.name}" loaded — press Save agent config to activate.` });
  }

  async function saveAsRuntimeTemplate() {
    if (!agentCfg) return;
    const name = runtimeTplName.trim();
    if (!name) return;
    try {
      const saved = await apiFetch<AgentRuntimeTemplate>("/agent-config-templates", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "",
          monitoring_interval_seconds: agentCfg.monitoring_interval_seconds,
          http_timeout_seconds: agentCfg.http_timeout_seconds,
          http_retry_count: agentCfg.http_retry_count,
          config_poll_interval_seconds: agentCfg.config_poll_interval_seconds,
          connectivity_poll_interval_seconds: agentCfg.connectivity_poll_interval_seconds,
          connectivity_targets: agentCfg.connectivity_targets,
        }),
      });
      setRuntimeTemplates((prev) => {
        const next = (prev ?? []).filter((x) => x.id !== saved.id);
        return [...next, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setRuntimeTplName("");
      showToast({ severity: "info", title: "Template saved", message: `"${saved.name}" is now reusable on other servers.` });
    } catch (err) {
      showToast({ severity: "critical", title: "Save failed", message: err instanceof Error ? err.message : undefined });
    }
  }

  async function deleteRuntimeTemplate() {
    const t = runtimeTemplates?.find((x) => x.id === runtimePick);
    if (!t || !confirm(`Delete runtime template "${t.name}"? Servers already using it are unaffected.`)) return;
    try {
      await apiFetch(`/agent-config-templates/${t.id}`, { method: "DELETE" });
      setRuntimeTemplates((prev) => (prev ?? []).filter((x) => x.id !== t.id));
      setRuntimePick("");
      showToast({ severity: "info", title: "Template deleted", message: `"${t.name}" removed from the library.` });
    } catch (err) {
      showToast({ severity: "critical", title: "Delete failed", message: err instanceof Error ? err.message : undefined });
    }
  }

  async function saveBackupCfg() {
    if (!id || !agentCfg) return;
    setSavingBackup(true);
    try {
      const saved = await apiFetch<AgentConfig>(`/agent-config/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          config_sync_enabled: agentCfg.config_sync_enabled,
          config_sync_hour: agentCfg.config_sync_hour,
          config_collections: agentCfg.config_collections,
          mongo_config_enabled: dbType === "mongo" ? agentCfg.mongo_config_enabled : false,
          mongo_uri: agentCfg.mongo_uri,
          mongo_auth_source: agentCfg.mongo_auth_source,
        }),
      });
      setAgentCfg(saved);
      showToast({
        severity: "info",
        title: "Backup config saved",
        message: "The site agent will reflect this change within a few seconds.",
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Save failed",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSavingBackup(false);
    }
  }

  async function testAndRunBackupNow() {
    if (!id || !agentCfg || !agentCfg.mongo_uri || testingBackup) return;
    setTestingBackup(true);
    setBackupProgressText("Connecting & Triggering...");

    let initialSnaps: ConfigSnapshotMeta[] = [];
    try {
      initialSnaps = await apiFetch<ConfigSnapshotMeta[]>(`/configs/servers/${id}`);
    } catch {
      initialSnaps = snapMeta || [];
    }

    const beforeMap = new Map<string, string>();
    for (const m of initialSnaps) {
      beforeMap.set(m.id, m.received_at);
    }

    try {
      const res = await apiFetch<{
        success: boolean;
        message: string;
        synced_from_hub?: boolean;
        synced_count?: number;
      }>(`/configs/servers/${id}/test-backup`, {
        method: "POST",
        body: JSON.stringify({
          mongo_uri: agentCfg.mongo_uri,
          mongo_auth_source: agentCfg.mongo_auth_source,
          mongo_config_enabled: true,
          config_collections: agentCfg.config_collections,
        }),
      });

      if (!res.success) {
        showToast({
          severity: "critical",
          title: "Test Connection Failed",
          message: res.message,
        });
        setTestingBackup(false);
        setBackupProgressText(null);
        return;
      }

      if (res.synced_from_hub) {
        showToast({
          severity: "info",
          title: "Backup Complete",
          message: res.message,
        });
        await loadSnapshots();
        setTestingBackup(false);
        setBackupProgressText(null);
        return;
      }

      // If remote site agent trigger was sent, poll every 2s for up to 45s
      const pollStartTime = Date.now();
      const timeoutMs = 45000;
      const pollIntervalMs = 2000;
      let backupArrived = false;

      while (Date.now() - pollStartTime < timeoutMs) {
        const elapsedSec = Math.round((Date.now() - pollStartTime) / 1000);
        setBackupProgressText(`Waiting for site agent (${elapsedSec}s)...`);

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        try {
          const latestSnaps = await apiFetch<ConfigSnapshotMeta[]>(`/configs/servers/${id}`);
          let hasNewOrUpdated = false;

          for (const m of latestSnaps) {
            const oldReceived = beforeMap.get(m.id);
            if (!oldReceived || new Date(m.received_at).getTime() > new Date(oldReceived).getTime()) {
              hasNewOrUpdated = true;
              break;
            }
          }

          if (hasNewOrUpdated) {
            setSnapMeta(latestSnaps);
            backupArrived = true;
            showToast({
              severity: "info",
              title: "Backup Received Successfully!",
              message: `Remote site agent uploaded config snapshots (${latestSnaps.length} collection(s) backed up).`,
            });
            break;
          }
        } catch {
          // keep polling
        }
      }

      if (!backupArrived) {
        await loadSnapshots();
        showToast({
          severity: "critical",
          title: "Backup Timed Out / Failed",
          message: "Remote site agent did not upload config within 45 seconds. Please verify site agent service status and MongoDB URI.",
        });
      }
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Test Connection Failed",
        message: err instanceof Error ? err.message : "Failed to test backup connection",
      });
    } finally {
      setTestingBackup(false);
      setBackupProgressText(null);
    }
  }

  async function loadSnapshots() {
    if (!id) return;
    const metas = await apiFetch<ConfigSnapshotMeta[]>(`/configs/servers/${id}`);
    setSnapMeta(metas);
  }

  async function loadWidgets() {
    if (!id) return;
    const items = await apiFetch<WidgetSample[]>(`/widgets/servers/${id}`);
    setWidgets(items);
  }

  async function triggerWidgetsNow() {
    if (!id || triggeringWidgets) return;
    setTriggeringWidgets(true);
    const beforeTime = Date.now();
    try {
      showToast({
        severity: "info",
        title: "Sending summary request...",
        message: "Summary request sent to site agent. Awaiting data...",
      });
      await apiFetch(`/widgets/servers/${id}/trigger`, { method: "POST" });
      const pollStart = Date.now();
      let arrived = false;
      while (Date.now() - pollStart < 20000) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const items = await apiFetch<WidgetSample[]>(`/widgets/servers/${id}`);
          if (items && items.length > 0) {
            const hasFresh = items.some(
              (item) => new Date(item.received_at).getTime() >= beforeTime - 2000
            );
            if (hasFresh) {
              setWidgets(items);
              arrived = true;
              break;
            }
          }
        } catch {
          // ignore transient errors while polling
        }
      }
      await loadWidgets();
      if (arrived) {
        showToast({
          severity: "info",
          title: "Summary data received",
          message: "Site agent successfully executed the query and returned the asked data.",
        });
      } else {
        showToast({
          severity: "info",
          title: "Summary request sent",
          message: "Request dispatched to site agent. Check back in a few seconds.",
        });
      }
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Request failed",
        message: err instanceof Error ? err.message : "Failed to send summary request",
      });
    } finally {
      setTriggeringWidgets(false);
    }
  }

  async function handleRefreshWidgets() {
    if ((widgets ?? []).length > 0 || (agentCfg?.custom_widgets ?? []).length > 0) {
      await triggerWidgetsNow();
    } else {
      setRefreshingWidgets(true);
      try {
        await Promise.all([
          loadWidgets(),
          loadAgentConfig().catch(() => {}),
        ]);
        showToast({ severity: "info", title: "Refreshed", message: "Data widgets refreshed." });
      } catch (err) {
        showToast({
          severity: "warning",
          title: "Refresh failed",
          message: err instanceof Error ? err.message : "Failed to refresh widgets",
        });
      } finally {
        setRefreshingWidgets(false);
      }
    }
  }

  // Determine an appropriate Lucide icon for a widget name
  function getWidgetIcon(name: string) {
    const lower = name.toLowerCase();
    if (
      lower.includes("pie") ||
      lower.includes("breakdown") ||
      lower.includes("rejection") ||
      lower.includes("distribution") ||
      lower.includes("ratio")
    ) {
      return PieChart;
    }
    if (
      lower.includes("activity") ||
      lower.includes("live") ||
      lower.includes("speed") ||
      lower.includes("throughput") ||
      lower.includes("rate")
    ) {
      return Activity;
    }
    if (
      lower.includes("db") ||
      lower.includes("database") ||
      lower.includes("mongo") ||
      lower.includes("table")
    ) {
      return Database;
    }
    return BarChart3;
  }

  // List of available data widgets for + set winget dropdown (strictly available widget templates)
  const availableWidgets = useMemo(() => {
    const list: { name: string; template: WidgetTemplate }[] = [];
    const seen = new Set<string>();

    for (const t of widgetTemplates ?? []) {
      if (t.name && !seen.has(t.name)) {
        seen.add(t.name);
        list.push({ name: t.name, template: t });
      }
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [widgetTemplates]);

  const activeWidgetNames = useMemo(() => {
    return new Set(
      (agentCfg?.custom_widgets ?? [])
        .filter((w) => w.enabled !== false)
        .map((w) => w.name)
    );
  }, [agentCfg?.custom_widgets]);

  async function handleToggleWidget(
    item: { name: string; template: WidgetTemplate },
    checked: boolean
  ) {
    if (!id) return;
    const currentList = [...(agentCfg?.custom_widgets ?? [])];
    let updatedWidgets: CustomWidgetSpec[];

    if (checked) {
      const existingIdx = currentList.findIndex((w) => w.name === item.name);
      if (existingIdx >= 0) {
        currentList[existingIdx] = { ...currentList[existingIdx], enabled: true };
        updatedWidgets = currentList;
      } else {
        const t = item.template;
        const spec: CustomWidgetSpec = {
          name: item.name,
          database: t.database || "octyn_services",
          collection: t.collection || "records",
          enabled: true,
          poll_interval_seconds: 60,
          window_minutes: t.window_minutes || 60,
          group_by_field: t.group_by_field || "upload_status",
          time_field: t.time_field || "created_at",
          max_groups: t.max_groups || 10,
          alert_threshold_percent: 50,
          alert_window_minutes: 15,
          include_values: t.include_values || [],
          exclude_values: t.exclude_values || [],
          template_id: t.id || undefined,
          template_name: item.name,
        };
        updatedWidgets = [...currentList, spec];
      }
    } else {
      updatedWidgets = currentList.filter((w) => w.name !== item.name);
    }

    try {
      const saved = await apiFetch<AgentConfig>(`/agent-config/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ custom_widgets: updatedWidgets }),
      });
      setAgentCfg(saved);
      showToast({
        severity: "info",
        title: checked ? `Set widget: ${item.name}` : `Unset widget: ${item.name}`,
        message: checked ? 'Click "Refresh" to query and get data from site server.' : undefined,
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Failed to update widget",
        message: err instanceof Error ? err.message : undefined,
      });
    }
  }

  function renderSetWidgetDropdown(align: "start" | "end" | "center" = "end", extraClass?: string) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title="Set data widgets"
            className={cn(
              "gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-medium shadow-none",
              extraClass
            )}
          >
            + set winget
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-64">
          <DropdownMenuLabel>Data Widgets</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availableWidgets.length === 0 ? (
            <div className="px-3 py-2 text-center text-xs text-slate-500">
              No data widgets available
            </div>
          ) : (
            availableWidgets.map((item) => {
              const isChecked = activeWidgetNames.has(item.name);
              const Icon = getWidgetIcon(item.name);
              return (
                <DropdownMenuCheckboxItem
                  key={item.name}
                  checked={isChecked}
                  onCheckedChange={(checked) => void handleToggleWidget(item, checked)}
                >
                  <Icon className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">{item.name}</span>
                </DropdownMenuCheckboxItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }


  async function loadWidgetHistory(name: string, force = false) {
    if (!id) return;
    if (!force && (loadingHist[name] || widgetHistory[name])) return;
    setLoadingHist((prev) => ({ ...prev, [name]: true }));
    try {
      const pts = await apiFetch<WidgetHistoryPoint[]>(
        `/widgets/servers/${id}/history?widget_name=${encodeURIComponent(name)}&hours=24`
      );
      setWidgetHistory((prev) => ({ ...prev, [name]: pts }));
    } catch {
      setWidgetHistory((prev) => ({ ...prev, [name]: [] }));
    } finally {
      setLoadingHist((prev) => ({ ...prev, [name]: false }));
    }
  }



  function widgetIntervalSeconds(name: string): number {
    const def = agentCfg?.custom_widgets?.find((w) => w.name === name);
    return def?.poll_interval_seconds ?? 60;
  }

  function widgetState(w: WidgetSample): "fresh" | "stale" | "error" {
    if (w.error) return "error";
    const ageMs = Date.now() - new Date(w.received_at).getTime();
    if (!isFinite(ageMs)) return "stale";
    return ageMs <= widgetIntervalSeconds(w.widget_name) * 2000 + 60000 ? "fresh" : "stale";
  }

  const GROUP_PALETTE_HEX = [
    "#38bdf8", // Sky Blue
    "#a855f7", // Purple
    "#f59e0b", // Amber
    "#10b981", // Emerald Green
    "#f43f5e", // Rose
    "#6366f1", // Indigo
    "#14b8a6", // Teal
    "#f97316", // Orange
    "#ec4899", // Pink
    "#84cc16", // Lime Green
    "#06b6d4", // Cyan
    "#eab308", // Yellow
  ];

  const GROUP_PALETTE_BG = [
    "bg-sky-500",
    "bg-purple-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-rose-500",
    "bg-indigo-500",
    "bg-teal-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-lime-500",
    "bg-cyan-500",
    "bg-yellow-500",
  ];

  function getLabelColorIndex(label: string): number {
    if (!label) return 0;
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = (hash << 5) - hash + label.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % GROUP_PALETTE_HEX.length;
  }

  function groupColor(label: string, index?: number): string {
    const l = (label || "").toLowerCase().trim();
    if (/(success|^ok$|passed|complete)/.test(l)) return "bg-emerald-500";
    if (/(^fail$|^error$|^expired$|^invalid$)/.test(l)) return "bg-red-500";
    if (/(^pending$|^retry$|^warn$)/.test(l)) return "bg-amber-500";
    if (index !== undefined && index >= 0) {
      return GROUP_PALETTE_BG[index % GROUP_PALETTE_BG.length];
    }
    return GROUP_PALETTE_BG[getLabelColorIndex(l)];
  }

  function groupHex(label: string, index?: number): string {
    const l = (label || "").toLowerCase().trim();
    if (/(success|^ok$|passed|complete)/.test(l)) return "#10b981";
    if (/(^fail$|^error$|^expired$|^invalid$)/.test(l)) return "#ef4444";
    if (/(^pending$|^retry$|^warn$)/.test(l)) return "#f59e0b";
    if (index !== undefined && index >= 0) {
      return GROUP_PALETTE_HEX[index % GROUP_PALETTE_HEX.length];
    }
    return GROUP_PALETTE_HEX[getLabelColorIndex(l)];
  }

  function widgetRangeLabel(w: { received_at: string; window_minutes: number }): string {
    const endMs = new Date(w.received_at).getTime();
    if (!isFinite(endMs)) return `last ${w.window_minutes}m → now`;
    const end = new Date(endMs);
    const from = new Date(endMs - w.window_minutes * 60000);
    const time = from.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const sameDay =
      from.getFullYear() === end.getFullYear() &&
      from.getMonth() === end.getMonth() &&
      from.getDate() === end.getDate();
    if (sameDay) return `${time} → now`;
    const date = from.toLocaleDateString([], { day: "numeric", month: "numeric" });
    return `${date}, ${time} → now`;
  }

  function trendTimeLabel(iso: string): string {
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return "";
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const today = new Date();
    if (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    )
      return time;
    const date = d.toLocaleDateString([], { day: "numeric", month: "numeric" });
    return `${date} ${time}`;
  }

  async function fetchSnapshotDocuments(snapshotId: string): Promise<Record<string, unknown>[]> {
    if (snapDocs[snapshotId]) return snapDocs[snapshotId];
    setLoadingSnapDocs(snapshotId);
    try {
      const full = await apiFetch<ConfigSnapshotFull & { server_id: string }>(
        `/configs/snapshots/${snapshotId}`
      );
      const docs = full.documents ?? [];
      setSnapDocs((prev) => ({ ...prev, [snapshotId]: docs }));
      return docs;
    } finally {
      setLoadingSnapDocs(null);
    }
  }

  function toggleView(meta: ConfigSnapshotMeta) {
    setHistoryFor(null);
    if (expandedSnap === meta.id) {
      setExpandedSnap(null);
      return;
    }
    setExpandedSnap(meta.id);
    void fetchSnapshotDocuments(meta.id);
  }

  async function openHistory(meta: ConfigSnapshotMeta) {
    setExpandedSnap(null);
    if (historyFor?.rowId === meta.id) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor({ rowId: meta.id, database: meta.database, collection: meta.collection });
    setLoadingHistory(true);
    try {
      const items = await apiFetch<ConfigSnapshotMeta[]>(
        `/configs/servers/${id}/history?database=${encodeURIComponent(meta.database)}&collection=${encodeURIComponent(meta.collection)}`
      );
      setHistoryItems(items);
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Failed to load history",
        message: err instanceof Error ? err.message : undefined,
      });
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function copySnapshot(meta: ConfigSnapshotMeta) {
    const docs = await fetchSnapshotDocuments(meta.id);
    try {
      await navigator.clipboard.writeText(JSON.stringify(docs, null, 2));
      showToast({ severity: "info", title: "Copied", message: `${meta.database}.${meta.collection} JSON copied.` });
    } catch {
      showToast({ severity: "critical", title: "Copy failed", message: "Clipboard unavailable." });
    }
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadSnapshot(meta: ConfigSnapshotMeta) {
    const docs = await fetchSnapshotDocuments(meta.id);
    const body = {
      database: meta.database,
      collection: meta.collection,
      captured_at: meta.captured_at,
      received_at: meta.received_at,
      count: meta.count,
      documents: docs,
    };
    saveBlob(
      new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }),
      `${meta.database}.${meta.collection}.json`
    );
  }

  async function downloadAllConfigs() {
    if (!snapMeta || !snapMeta.length || !site) return;
    setExporting(`Exporting 0/${snapMeta.length}…`);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let done = 0;
      for (const meta of snapMeta) {
        setExporting(`Exporting ${done + 1}/${snapMeta.length}…`);
        const docs = await fetchSnapshotDocuments(meta.id);
        zip.file(
          `${meta.database}.${meta.collection}.json`,
          JSON.stringify(
            {
              database: meta.database,
              collection: meta.collection,
              captured_at: meta.captured_at,
              received_at: meta.received_at,
              count: meta.count,
              truncated: meta.truncated,
              documents: docs,
            },
            null,
            2
          )
        );
        done += 1;
      }
      const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
      const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, "_");
      const zipName = `${safe(site.client)}_${safe(site.location)}_${stamp}.zip`;
      const blob = await zip.generateAsync({ type: "blob" });
      saveBlob(blob, zipName);
      showToast({ severity: "info", title: "Export ready", message: zipName });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Export failed",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    loadSnapshots().catch(() => setSnapMeta([]));
    loadAgentConfig().catch(() => { });
    loadConnectivity().catch(() => { });
    loadWidgets().catch(() => setWidgets([]));
    apiFetch<WidgetTemplate[]>("/widgets/templates").then(setWidgetTemplates).catch(() => setWidgetTemplates([]));
    const t = setInterval(() => {
      load().catch(() => { });
    }, 30000); // fallback; socket keeps it live
    const connectivityTimer = setInterval(() => {
      loadConnectivity().catch(() => { });
    }, 10000); // fallback if a websocket event is missed

    const socket = getSocket();
    const joinServerRoom = () => {
      if (id) socket.emit("join", id);
    };
    joinServerRoom();

    const onMetric = (m: Metric) => {
      if (m.server_id !== id) return;
      setMetrics((prev) => {
        const next = [...prev.filter((x) => x.recorded_at < m.recorded_at), m];
        return next.slice(-1000);
      });
      setServer((prev) => (prev ? { ...prev, last_seen_at: m.recorded_at } : prev));
    };
    const onServiceUpdate = (d: { server_id: string }) => {
      if (d.server_id === id) {
        apiFetch<Service[]>(`/servers/${id}/services`).then(setServices).catch(() => { });
      }
    };
    const onStatus = (d: { server_id: string; status: Server["status"] }) => {
      if (d.server_id === id) {
        setServer((prev) => (prev ? { ...prev, status: d.status } : prev));
      }
    };
    const onServerUpdated = (updated: Server) => {
      if (updated.id === id) {
        setServer(updated);
      }
    };
    const onConnectivity = (d: { server_id: string; targets: ConnectivityStatus[] }) => {
      if (d.server_id === id) {
        setConnectivity(d.targets);
      }
    };
    const onConfigSnapshot = (d: { server_id: string }) => {
      if (d.server_id === id) {
        loadSnapshots().catch(() => { });
      }
    };
    socket.on("metric", onMetric);
    socket.on("service_update", onServiceUpdate);
    socket.on("server_status", onStatus);
    socket.on("server_updated", onServerUpdated);
    socket.on("connectivity", onConnectivity);
    socket.on("config_snapshot", onConfigSnapshot);
    socket.on("connect", joinServerRoom);
    return () => {
      clearInterval(t);
      clearInterval(connectivityTimer);
      if (id) socket.emit("leave", id);
      socket.off("metric", onMetric);
      socket.off("service_update", onServiceUpdate);
      socket.off("server_status", onStatus);
      socket.off("server_updated", onServerUpdated);
      socket.off("connectivity", onConnectivity);
      socket.off("config_snapshot", onConfigSnapshot);
      socket.off("connect", joinServerRoom);
    };
  }, [id, range]);

  async function createKey() {
    if (!id) return;
    const res = await apiFetch<ApiKey & { raw_key: string }>(`/servers/${id}/api-keys`, {
      method: "POST",
      body: JSON.stringify({ name: keyName || "agent" }),
    });
    setNewKey(res.raw_key);
    setKeyName("");
    const k = await apiFetch<ApiKey[]>(`/servers/${id}/api-keys`);
    setKeys(k);
  }

  async function revokeKey(keyId: string) {
    if (!id) return;
    await apiFetch(`/api-keys/${keyId}`, { method: "DELETE" });
    const k = await apiFetch<ApiKey[]>(`/servers/${id}/api-keys`);
    setKeys(k);
  }

  async function deleteKey(keyId: string) {
    if (!id) return;
    if (!confirm("Permanently delete this revoked API key record?")) return;
    try {
      await apiFetch(`/api-keys/${keyId}?force=true`, { method: "DELETE" });
      showToast({ severity: "info", title: "API Key Deleted", message: "Revoked key entry permanently removed." });
      const k = await apiFetch<ApiKey[]>(`/servers/${id}/api-keys`);
      setKeys(k);
    } catch (err) {
      showToast({ severity: "critical", title: "Delete Failed", message: err instanceof Error ? err.message : "Error" });
    }
  }

  async function addService() {
    if (!id || !newServiceName.trim() || addingService) return;
    setAddingService(true);
    try {
      await apiFetch(`/servers/${id}/services`, {
        method: "POST",
        body: JSON.stringify({
          name: newServiceName.trim(),
          port: newServicePort.trim() ? Number(newServicePort.trim()) : undefined,
          enabled: true,
        }),
      });
      showToast({ severity: "info", title: "Service Added", message: `Monitoring service "${newServiceName.trim()}"` });
      setNewServiceName("");
      setNewServicePort("");
      setShowAddService(false);
      const s = await apiFetch<Service[]>(`/servers/${id}/services`);
      setServices(s);
    } catch (err) {
      showToast({ severity: "critical", title: "Failed to Add Service", message: err instanceof Error ? err.message : "Error" });
    } finally {
      setAddingService(false);
    }
  }

  async function toggleServiceEnabled(s: Service) {
    const nextEnabled = !(s.enabled ?? true);
    try {
      await apiFetch(`/services/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      showToast({
        severity: "info",
        title: nextEnabled ? "Service Enabled" : "Service Disabled",
        message: `Monitoring ${nextEnabled ? "enabled" : "disabled"} for "${s.name}"`,
      });
      const updated = await apiFetch<Service[]>(`/servers/${id}/services`);
      setServices(updated);
    } catch (err) {
      showToast({ severity: "critical", title: "Update Failed", message: err instanceof Error ? err.message : "Error" });
    }
  }

  async function deleteService(serviceId: string, serviceName: string) {
    if (!confirm(`Delete service "${serviceName}" from monitoring list?`)) return;
    try {
      await apiFetch(`/services/${serviceId}`, { method: "DELETE" });
      showToast({ severity: "info", title: "Service Deleted", message: `Removed "${serviceName}" from monitoring` });
      const updated = await apiFetch<Service[]>(`/servers/${id}/services`);
      setServices(updated);
    } catch (err) {
      showToast({ severity: "critical", title: "Delete Failed", message: err instanceof Error ? err.message : "Error" });
    }
  }

  function startEditService(s: Service) {
    setEditingServiceId(s.id);
    setEditServiceName(s.name);
    setEditServicePort(s.port != null ? String(s.port) : "");
  }

  async function saveServiceEdit() {
    if (!id || !editingServiceId || savingServiceEdit) return;
    const name = editServiceName.trim();
    if (!name) {
      showToast({ severity: "critical", title: "Invalid name", message: "Service name must not be blank." });
      return;
    }
    const portRaw = editServicePort.trim();
    const port = portRaw ? Number(portRaw) : null;
    if (portRaw && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)) {
      showToast({ severity: "critical", title: "Invalid port", message: "Port must be 1–65535 or blank." });
      return;
    }
    setSavingServiceEdit(true);
    try {
      await apiFetch(`/services/${editingServiceId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, port }),
      });
      showToast({ severity: "info", title: "Service Updated", message: `Saved "${name}"${port ? ` :${port}` : ""}` });
      setEditingServiceId(null);
      const updated = await apiFetch<Service[]>(`/servers/${id}/services`);
      setServices(updated);
    } catch (err) {
      showToast({ severity: "critical", title: "Update Failed", message: err instanceof Error ? err.message : "Error" });
    } finally {
      setSavingServiceEdit(false);
    }
  }

  function openServerEdit() {
    if (!server) return;
    setEditServerName(server.name);
    setEditServerHostname(server.hostname);
    setEditServerIp(server.ip_address ?? "");
    setEditServerSiteId(server.site_id);
    setServerEditOpen(true);
  }

  async function saveServerEdit() {
    if (!id || savingServer) return;
    const name = editServerName.trim();
    const hostname = editServerHostname.trim();
    if (!name || !hostname) {
      showToast({ severity: "critical", title: "Invalid server", message: "Name and hostname must not be blank." });
      return;
    }
    setSavingServer(true);
    try {
      const updated = await apiFetch<Server>(`/servers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          hostname,
          ip_address: editServerIp.trim() ? editServerIp.trim() : null,
          ...(server && editServerSiteId && editServerSiteId !== server.site_id
            ? { site_id: editServerSiteId }
            : {}),
        }),
      });
      setServer(updated);
      const matchedSite = allSites.find((x) => x.id === updated.site_id) ?? null;
      setSite(matchedSite);
      setServerEditOpen(false);
      showToast({ severity: "info", title: "Server Updated", message: `Saved "${updated.name}".` });
    } catch (err) {
      showToast({ severity: "critical", title: "Update Failed", message: err instanceof Error ? err.message : "Error" });
    } finally {
      setSavingServer(false);
    }
  }

  // ---- Compact services: search + status filter + pagination ----
  // NOTE: hooks must stay above the `if (!server)` early return (React error #310).
  const svcCounts = useMemo(() => {
    let running = 0;
    let stopped = 0;
    let disabled = 0;
    for (const s of services) {
      if (!(s.enabled ?? true)) disabled += 1;
      else if (s.status === "running") running += 1;
      else if (s.status === "stopped") stopped += 1;
    }
    return { running, stopped, disabled, total: services.length };
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = svcQuery.trim().toLowerCase();
    return services.filter((s) => {
      if (svcStatus === "disabled" && (s.enabled ?? true)) return false;
      if (svcStatus === "running" && (!(s.enabled ?? true) || s.status !== "running")) return false;
      if (svcStatus === "stopped" && (!(s.enabled ?? true) || s.status !== "stopped")) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        String(s.port ?? "").includes(q)
      );
    });
  }, [services, svcQuery, svcStatus]);

  // ---- Backups grouped by database ----
  const backupGroups = useMemo(() => {
    const list = snapMeta ?? [];
    const q = backupQuery.trim().toLowerCase();
    const byDb = new Map<string, ConfigSnapshotMeta[]>();
    for (const m of list) {
      if (q && !`${m.database}.${m.collection}`.toLowerCase().includes(q)) continue;
      const arr = byDb.get(m.database) ?? [];
      arr.push(m);
      byDb.set(m.database, arr);
    }
    const groups = [...byDb.entries()].map(([database, items]) => {
      items.sort((a, b) => a.collection.localeCompare(b.collection));
      const totalDocs = items.reduce((n, x) => n + (x.count ?? 0), 0);
      const lastReceived = items.reduce((max, x) => (x.received_at > max ? x.received_at : max), items[0]?.received_at ?? "");
      return { database, items, totalDocs, lastReceived };
    });
    groups.sort((a, b) => (b.lastReceived > a.lastReceived ? 1 : b.lastReceived < a.lastReceived ? -1 : 0));
    return groups;
  }, [snapMeta, backupQuery]);

  const chartData = metrics.map((m) => ({
    time: new Date(m.recorded_at).toLocaleTimeString(),
    cpu: m.cpu_percent,
    memory: m.memory_percent,
    disk: m.disk_percent,
    sent: m.network_bytes_sent / (1024 * 1024),
    received: m.network_bytes_received / (1024 * 1024),
    diskReadRate: m.disk_read_rate_mb ?? 0,
    diskWriteRate: m.disk_write_rate_mb ?? 0,
    diskIops: m.disk_iops ?? 0,
    apiRequests: m.api_requests_total ?? 0,
    apiErrors4xx: m.api_requests_4xx ?? 0,
    apiErrors5xx: m.api_requests_5xx ?? 0,
    apiErrorRate: m.api_error_rate_percent ?? 0,
  }));

  if (!server) {
    return (
      <div className="flex flex-col gap-6">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[280px] w-full" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latest = metrics[metrics.length - 1];

  // Compute Peak (Max) and Avg over selected metrics window
  const stats = metrics.reduce(
    (acc, m) => {
      acc.cpuMax = Math.max(acc.cpuMax, m.cpu_percent);
      acc.cpuSum += m.cpu_percent;
      acc.memMax = Math.max(acc.memMax, m.memory_percent);
      acc.memSum += m.memory_percent;
      acc.diskMax = Math.max(acc.diskMax, m.disk_percent);
      acc.diskSum += m.disk_percent;

      const rRate = m.disk_read_rate_mb ?? 0;
      acc.readMax = Math.max(acc.readMax, rRate);
      acc.readSum += rRate;

      const wRate = m.disk_write_rate_mb ?? 0;
      acc.writeMax = Math.max(acc.writeMax, wRate);
      acc.writeSum += wRate;

      const iops = m.disk_iops ?? 0;
      acc.iopsMax = Math.max(acc.iopsMax, iops);
      acc.iopsSum += iops;

      acc.count += 1;
      return acc;
    },
    {
      cpuMax: 0,
      cpuSum: 0,
      memMax: 0,
      memSum: 0,
      diskMax: 0,
      diskSum: 0,
      readMax: 0,
      readSum: 0,
      writeMax: 0,
      writeSum: 0,
      iopsMax: 0,
      iopsSum: 0,
      count: 0,
    }
  );

  const statCount = stats.count || 1;
  const avgCpu = (stats.cpuSum / statCount).toFixed(1);
  const avgMem = (stats.memSum / statCount).toFixed(1);
  const avgRead = (stats.readSum / statCount).toFixed(1);
  const avgWrite = (stats.writeSum / statCount).toFixed(1);
  const avgIops = Math.round(stats.iopsSum / statCount);

  const svcTotalPages = Math.max(1, Math.ceil(filteredServices.length / SVC_PAGE_SIZE));
  const safeSvcPage = Math.min(svcPage, svcTotalPages - 1);
  const pagedServices = filteredServices.slice(
    safeSvcPage * SVC_PAGE_SIZE,
    safeSvcPage * SVC_PAGE_SIZE + SVC_PAGE_SIZE
  );

  const backupDbCount = backupGroups.length;
  const backupCollCount = backupGroups.reduce((n, g) => n + g.items.length, 0);

  // ---- Overview helpers (plain values, safe below early return) ----
  function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || !isFinite(bytes) || bytes < 0) return "—";
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${Math.round(bytes)} B`;
  }

  function formatUptime(totalSeconds: number | null | undefined): string {
    if (totalSeconds == null || !isFinite(totalSeconds)) return "—";
    const s = Math.max(0, Math.floor(totalSeconds));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  type CheckState = "pass" | "fail" | "neutral";

  const lastSeenSecs =
    server.last_seen_at
      ? Math.max(0, (Date.now() - new Date(server.last_seen_at).getTime()) / 1000)
      : null;
  const heartbeatThreshold = (agentCfg?.monitoring_interval_seconds ?? 30) * 3 + 30;
  const heartbeatOk = lastSeenSecs != null && lastSeenSecs <= heartbeatThreshold;
  const enabledServices = services.filter((s) => s.enabled ?? true);
  const runningServices = enabledServices.filter((s) => s.status === "running");
  const connList = connectivity ?? [];
  const reachableTargets = connList.filter((c) => c.reachable);
  const memUsed =
    latest && latest.memory_total ? latest.memory_total - (latest.memory_available ?? 0) : null;
  const diskUsed = latest && latest.disk_total ? latest.disk_total - (latest.disk_free ?? 0) : null;

  const statusChecks: { label: string; detail: string; state: CheckState }[] = [
    {
      label: "Agent heartbeat",
      detail:
        lastSeenSecs == null
          ? "Never reported"
          : `Last seen ${formatTime(server.last_seen_at)} (every ${agentCfg?.monitoring_interval_seconds ?? "—"}s)`,
      state: heartbeatOk ? "pass" : "fail",
    },
    {
      label: "Monitored services",
      detail:
        services.length === 0
          ? "No services configured"
          : `${runningServices.length}/${enabledServices.length} running`,
      state:
        services.length === 0
          ? "neutral"
          : runningServices.length === enabledServices.length
            ? "pass"
            : "fail",
    },
    {
      label: "Device connectivity",
      detail: !connectivity
        ? "Loading…"
        : connectivity.length === 0
          ? "No targets configured"
          : `${reachableTargets.length}/${connectivity.length} reachable`,
      state: !connectivity || connectivity.length === 0
        ? "neutral"
        : reachableTargets.length === connectivity.length
          ? "pass"
          : "fail",
    },
    {
      label: "Config backups",
      detail: !snapMeta
        ? "Loading…"
        : snapMeta.length === 0
          ? "No snapshots yet"
          : `${snapMeta.length} collections · latest ${formatTime(backupGroups[0]?.lastReceived ?? snapMeta[0].received_at)}`,
      state: !snapMeta || snapMeta.length === 0 ? "neutral" : "pass",
    },
  ];

  const failedChecks = statusChecks.filter((c) => c.state === "fail").length;
  const activeAlarmCount = alerts?.length ?? 0;
  const connUnreachable = (connectivity ?? []).filter((c) => !c.reachable).length;
  const healthExpanded = healthOpen ?? (failedChecks > 0 || activeAlarmCount > 0);
  const connExpanded = connOpen ?? connUnreachable > 0;

  function toggleDb(database: string) {
    setExpandedDbs((prev) => ({ ...prev, [database]: !prev[database] }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          {site && (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                <Building2 className="h-3 w-3" />
                {site.client}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                <MapPin className="h-3 w-3" />
                {site.location}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight">{server.name}</h1>
          <p className="text-sm text-slate-400">
            {server.hostname} · {server.ip_address ?? "no IP"} · last seen {formatTime(server.last_seen_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={openServerEdit}
              title="Edit server name, hostname, IP and site"
            >
              <Pencil className="mr-1.5 h-4 w-4 text-sky-400" />
              Edit server
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAgentCfgOpen(true)}
            disabled={!server}
            title="Edit monitoring, service and connectivity runtime settings"
          >
            <Settings2 className="mr-1.5 h-4 w-4 text-emerald-400" />
            Agent runtime
          </Button>

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/servers/${id}/terminal`, "_blank", "noopener,noreferrer")}
              title="Open a terminal for this site server"
              aria-label="Open terminal"
              className="h-9 w-9 px-0"
            >
              <Terminal className="h-4 w-4 text-amber-400" />
            </Button>
          )}


          <Button variant="outline" size="sm" onClick={exportMetricsCsv} title="Export server metrics CSV">
            <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-400" />
            Export Metrics CSV
          </Button>

          {(() => {
            const DOT: Record<string, { ping: string; core: string }> = {
              online: { ping: "bg-emerald-400", core: "bg-emerald-500" },
              warning: { ping: "bg-amber-400", core: "bg-amber-500" },
              offline: { ping: "bg-red-400", core: "bg-red-500" },
              unknown: { ping: "bg-slate-400", core: "bg-slate-500" },
            };
            const dot = DOT[server.status] ?? DOT.unknown;
            return (
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                    dot.ping
                  )}
                ></span>
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", dot.core)}></span>
              </span>
            );
          })()}
          <StatusBadge status={server.status} />
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Section tabs — keeps long port & backup lists out of the overview scroll */}
      <div className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto bg-background/95 px-1 py-1 backdrop-blur">
        {(
          [
            { id: "overview", label: "Overview" },
            { id: "services", label: `Services (${svcCounts.total})` },
            { id: "backups", label: `Backups (${backupCollCount})` },
            { id: "keys", label: `Keys (${keys.length})` },
            { id: "logs", label: `Logs (${siteAlerts.length > 0 ? siteAlerts.length : agentLogTotal})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === t.id
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
      <>
      {/* System health: status checks + active alarms */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 py-3">
          <button
            type="button"
            onClick={() => setHealthOpen(!healthExpanded)}
            className="flex min-w-0 items-center gap-2 text-left"
            title={healthExpanded ? "Collapse section" : "Expand section"}
          >
            {healthExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            <CardTitle className="text-sm">System health</CardTitle>
            <span className="hidden truncate text-[11px] font-normal text-slate-500 md:inline">
              {statusChecks.length} checks · {activeAlarmCount} alarm{activeAlarmCount === 1 ? "" : "s"}
            </span>
          </button>
          {failedChecks === 0 && activeAlarmCount === 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              All systems operational
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              {failedChecks + activeAlarmCount} issue{(failedChecks + activeAlarmCount) === 1 ? "" : "s"} need attention
            </span>
          )}
        </CardHeader>
        <CardContent className={cn("flex flex-col gap-3", !healthExpanded && "hidden")}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:grid-cols-4">
            {statusChecks.map((c) => (
              <div
                key={c.label}
                className="flex items-center gap-2.5 rounded-lg border border-slate-800/60 bg-slate-950/50 px-3 py-2"
              >
                {c.state === "pass" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : c.state === "fail" ? (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                ) : (
                  <MinusCircle className="h-4 w-4 shrink-0 text-slate-500" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-200">{c.label}</p>
                  <p className="truncate text-[11px] text-slate-500" title={c.detail}>{c.detail}</p>
                </div>
                <span
                  className={cn(
                    "ml-auto shrink-0 text-[11px] font-semibold",
                    c.state === "pass"
                      ? "text-emerald-400"
                      : c.state === "fail"
                        ? "text-red-400"
                        : "text-slate-500"
                  )}
                >
                  {c.state === "pass" ? "Passed" : c.state === "fail" ? "Failed" : "—"}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-800/60 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Bell className="h-3.5 w-3.5" />
                Active alarms{alerts ? ` (${alerts.length})` : ""}
              </p>
              <Link to="/alerts" className="text-xs font-medium text-emerald-300 hover:text-emerald-200">
                View all
              </Link>
            </div>
            {!alerts ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : alerts.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                No active alarms — all clear.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {alerts.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-800/60 bg-slate-950/50 px-3 py-2"
                    title={a.message}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        a.severity === "critical"
                          ? "bg-red-400"
                          : a.severity === "warning"
                            ? "bg-amber-400"
                            : "bg-sky-400"
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-200">
                        {a.type}
                        <span className="ml-1.5 font-normal text-slate-500">{a.severity}</span>
                      </p>
                      <p className="truncate text-[11px] text-slate-500">{a.message}</p>
                    </div>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                      {formatTime(a.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className={cn("overflow-hidden transition-colors duration-200", connUnreachable > 0 && "border-amber-500/40 bg-amber-950/10")}>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 py-2.5">
          <button
            type="button"
            onClick={() => setConnOpen(!connExpanded)}
            className="flex min-w-0 items-center gap-2 text-left"
            title={connExpanded ? "Collapse section" : "Expand section"}
          >
            {connExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <Activity className={cn("h-4 w-4 shrink-0 transition-colors", connUnreachable > 0 ? "text-amber-400 animate-pulse" : "text-emerald-400")} />
            <CardTitle className="text-xs font-semibold text-slate-200">Device connectivity</CardTitle>
          </button>
          <span className={cn("font-mono text-[11px]", connUnreachable > 0 ? "font-semibold text-amber-400" : "text-slate-500")}>
            {!connectivity
              ? "loading…"
              : connectivity.length === 0
                ? "no targets"
                : connUnreachable > 0
                  ? `${connUnreachable} unreachable · ${reachableTargets.length}/${connectivity.length} reachable`
                  : `${connectivity.length}/${connectivity.length} reachable`}
          </span>
        </CardHeader>
        <CardContent className={cn("px-4 pb-3", !connExpanded && "hidden")}>
          {!connectivity ? (
            <p className="text-xs text-slate-500">Loading device status…</p>
          ) : connectivity.length === 0 ? (
            <p className="text-xs text-slate-500">
              No device targets configured — add them via "Agent runtime".
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {connectivity.map((c) => (
                <div
                  key={c.name + c.ip}
                  className={cn(
                    "flex flex-col justify-between rounded-lg border p-2 transition-all duration-200",
                    c.reachable === false
                      ? "border-amber-500/50 bg-amber-950/25 shadow-[0_0_12px_rgba(245,158,11,0.15)] hover:border-amber-400/80"
                      : "border-slate-800/80 bg-slate-950/60 hover:border-slate-700/80"
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {c.reachable === null ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500" />
                      ) : c.reachable ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse" />
                      )}
                      <span className="truncate text-xs font-semibold text-slate-200" title={c.name}>
                        {c.name}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-[10px] font-bold ${
                        c.reachable === null
                          ? "text-slate-500"
                          : c.reachable
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }`}
                    >
                      {c.reachable === null
                        ? "—"
                        : c.reachable
                        ? c.latency_ms != null
                          ? `${c.latency_ms}ms`
                          : "OK"
                        : "UNREACHABLE"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-500">
                    <span className="truncate" title={c.ip}>{c.ip}</span>
                    {c.checked_at && (
                      <span className="shrink-0 text-[9px] opacity-60">
                        {formatTime(c.checked_at)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SectionHead title="Key metrics" sub="Live values with trend and window avg / peak" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader className="pb-1"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">CPU Load</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-sky-400">{latest ? `${latest.cpu_percent}%` : "—"}</div>
            <Spark id="spark-cpu" data={chartData.slice(-60)} dataKey="cpu" color="#38bdf8" />
            <div className="mt-1 flex items-center justify-between border-t border-slate-800/60 pt-1.5 font-mono text-[10px] text-slate-400">
              <span>Avg: {avgCpu}%</span>
              <span className="font-semibold text-sky-300">Peak: {stats.cpuMax}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader className="pb-1"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">Memory</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-purple-400">{latest ? `${latest.memory_percent}%` : "—"}</div>
            <Spark id="spark-mem" data={chartData.slice(-60)} dataKey="memory" color="#a78bfa" />
            <div className="mt-1 flex items-center justify-between border-t border-slate-800/60 pt-1.5 font-mono text-[10px] text-slate-400">
              <span>Avg: {avgMem}%</span>
              <span className="font-semibold text-purple-300">Peak: {stats.memMax}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader className="pb-1"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">Disk Space</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-amber-400">{latest ? `${latest.disk_percent}%` : "—"}</div>
            <Spark id="spark-disk" data={chartData.slice(-60)} dataKey="disk" color="#fbbf24" />
            <div className="mt-1 flex items-center justify-between border-t border-slate-800/60 pt-1.5 font-mono text-[10px] text-slate-400">
              <span>Used: {latest ? `${latest.disk_percent}%` : "—"}</span>
              <span className="font-semibold text-amber-300">Peak: {stats.diskMax}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader className="pb-1"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">Uptime</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-2xl font-extrabold text-slate-100">
              <Clock className="h-5 w-5 text-slate-400" />
              {formatUptime(latest?.uptime_seconds)}
            </div>
            <div className="mt-1 border-t border-slate-800/60 pt-1.5 font-mono text-[10px] text-slate-400">
              Since last reboot · every {agentCfg?.monitoring_interval_seconds ?? "—"}s checks
            </div>
            <div className="mt-1 h-[44px]" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-2 py-3">
          <Activity className="h-4 w-4 text-emerald-400" />
          <CardTitle className="text-sm">Throughput & capacity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Disk read</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">avg {avgRead} · peak {stats.readMax} MB/s</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Disk write</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">avg {avgWrite} · peak {stats.writeMax} MB/s</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Disk IOPS</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">avg {avgIops} · peak {stats.iopsMax} ops/s</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Network sent</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">{latest ? formatBytes(latest.network_bytes_sent) : "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Network received</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">{latest ? formatBytes(latest.network_bytes_received) : "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Memory used</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">
                {latest && latest.memory_total ? `${formatBytes(memUsed)} of ${formatBytes(latest.memory_total)}` : "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Disk used</p>
              <p className="mt-0.5 truncate font-mono text-sm text-slate-200">
                {latest && latest.disk_total ? `${formatBytes(diskUsed)} of ${formatBytes(latest.disk_total)}` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data widgets on overview — Bar / Pie / Trend per widget */}
      {(() => {
         const defs = agentCfg?.custom_widgets ?? [];
         const defByName = new Map(defs.map((d) => [d.name, d]));
         const activeNames = new Set(defs.map((d) => d.name));
         const activeSamples = (widgets ?? []).filter((s) => activeNames.has(s.widget_name));
         const seen = new Set(activeSamples.map((s) => s.widget_name));
         const entries: { def?: CustomWidgetSpec; sample?: WidgetSample }[] = [
           ...activeSamples.map((s) => ({ sample: s, def: defByName.get(s.widget_name) })),
           ...defs.filter((d) => !seen.has(d.name)).map((d) => ({ def: d })),
          ].sort((a, b) => {
            const an = (a as { def?: CustomWidgetSpec; sample?: WidgetSample }).def?.name ?? ((a as { sample?: WidgetSample }).sample?.widget_name ?? "");
            const bn = (b as { def?: CustomWidgetSpec; sample?: WidgetSample }).def?.name ?? ((b as { sample?: WidgetSample }).sample?.widget_name ?? "");
            return an.localeCompare(bn);
          });

        if (entries.length === 0) {
          return (
            <Card>
              <CardHeader className="flex-col gap-1">
                <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">Data widgets</CardTitle>
                    <p className="mt-0.5 text-xs text-slate-500">
                      On-demand tallies queried from site MongoDB (zero background DB load).
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-700/80 bg-slate-950/40 py-10 px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-400">
                    <BarChart3 className="h-6 w-6 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      No data widgets active yet
                    </p>
                    <p className="mt-1 text-xs text-slate-400 max-w-md">
                      Click <span className="font-semibold text-emerald-400">&ldquo;+ set winget&rdquo;</span> to select data widgets, then click <span className="font-semibold text-slate-200">&ldquo;Refresh&rdquo;</span> to get data.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={triggeringWidgets || refreshingWidgets}
                      onClick={() => void handleRefreshWidgets()}
                      className="gap-1.5 border-slate-700 text-slate-300 hover:text-white"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", (triggeringWidgets || refreshingWidgets) && "animate-spin text-emerald-400")} />
                      Refresh
                    </Button>
                    {renderSetWidgetDropdown("center", "bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm border-transparent")}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        }

        return (
          <Card>
            <CardHeader className="flex-col gap-1">
              <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">Data widgets ({entries.length})</CardTitle>
                  <p className="mt-0.5 text-xs text-slate-500">
                    On-demand tallies from the site agent — select via + set winget and click Refresh.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={triggeringWidgets || refreshingWidgets}
                    onClick={() => void handleRefreshWidgets()}
                    title="Refresh data widgets"
                    className="gap-1.5 text-xs text-slate-300 hover:text-white"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", (triggeringWidgets || refreshingWidgets) && "animate-spin text-emerald-400")} />
                    Refresh
                  </Button>
                  {renderSetWidgetDropdown("end")}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map(({ def, sample }) => {
                  const name = sample?.widget_name ?? def?.name ?? "?";
                  const gid = name.replace(/[^A-Za-z0-9_-]/g, "_");
                  const mode = defaultChart;
                  const state = sample ? widgetState(sample) : "stale";
                  const groups = Object.entries(sample?.groups ?? {}).sort((a, b) => b[1] - a[1]);
                  const total = sample?.total ?? 0;
                  const pieTop = groups.slice(0, 6);
                  const pieOther = groups.slice(6).reduce((n, [, c]) => n + c, 0);
                  const pieData = [
                    ...pieTop.map(([label, value]) => ({ name: label, value })),
                    ...(pieOther > 0 ? [{ name: "Other", value: pieOther }] : []),
                  ];
                  const hist = widgetHistory[name] ?? [];
                  // Dynamic top groups across history (no hardcoded status names)
                  const trendPeak: Record<string, number> = {};
                  for (const p of hist) {
                    for (const [k, v] of Object.entries(p.groups ?? {})) {
                      trendPeak[k] = Math.max(trendPeak[k] ?? 0, v);
                    }
                  }
                  if (sample) {
                    for (const [k, v] of Object.entries(sample.groups ?? {})) {
                      trendPeak[k] = Math.max(trendPeak[k] ?? 0, v);
                    }
                  }
                  const trendKeys = Object.entries(trendPeak)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([k]) => k);
                  const trendData = hist.map((p) => ({
                    time: trendTimeLabel(p.received_at),
                    total: p.total,
                    groups: p.groups ?? {},
                  }));
                  return (
                    <div
                      key={name}
                      className="flex flex-col gap-2 rounded-xl border border-slate-800/70 bg-slate-950/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100" title={name}>
                            {name}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                            {sample
                              ? `${sample.database}.${sample.collection} · last ${sample.window_minutes}m`
                              : `${def?.database}.${def?.collection} · single-time on-demand`}
                          </p>
                        </div>
                        {sample && (
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              state === "error"
                                ? "bg-red-500/10 text-red-300"
                                : state === "stale"
                                  ? "bg-amber-500/10 text-amber-300"
                                  : "bg-emerald-500/10 text-emerald-300"
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                state === "error"
                                  ? "bg-red-400"
                                  : state === "stale"
                                    ? "bg-amber-400"
                                    : "bg-emerald-400"
                              )}
                            />
                            {state === "error" ? "Error" : state === "stale" ? "Stale" : "Live"}
                          </span>
                        )}
                      </div>

                      {!sample ? (
                        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
                          <p className="text-xs text-slate-500">
                            Widget set. Click Refresh to get data from site agent.
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={triggeringWidgets || refreshingWidgets}
                            onClick={() => void handleRefreshWidgets()}
                            className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 h-7 gap-1.5"
                          >
                            <RefreshCw className={cn("h-3 w-3", (triggeringWidgets || refreshingWidgets) && "animate-spin")} />
                            Refresh to get data
                          </Button>
                        </div>
                      ) : sample.error ? (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                          Agent reported: {sample.error}
                        </div>
                      ) : mode === "pie" ? (
                        pieData.length === 0 ? (
                          <p className="py-6 text-center text-xs text-slate-500">No events in this window.</p>
                        ) : (
                          <div>
                            <ResponsiveContainer width="100%" height={170}>
                              <PieChart>
                                <Pie
                                  data={pieData}
                                  dataKey="value"
                                  nameKey="name"
                                  innerRadius={48}
                                  outerRadius={72}
                                  paddingAngle={2}
                                  strokeWidth={0}
                                >
                                  {pieData.map((d, i) => (
                                    <Cell key={d.name} fill={groupHex(d.name, i)} />
                                  ))}
                                </Pie>
                                <Tooltip content={<WidgetTooltip />} cursor={{ stroke: "#334155" }} />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                              {pieData.map((d, i) => (
                                <span key={d.name} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ background: groupHex(d.name, i) }}
                                  />
                                  {d.name || "(blank)"} · {d.value.toLocaleString()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      ) : mode === "trend" ? (
                        loadingHist[name] && hist.length === 0 ? (
                          <div className="flex flex-col gap-2 py-2">
                            <Skeleton className="h-36 w-full rounded-lg" />
                          </div>
                        ) : hist.length < 2 ? (
                          <p className="py-6 text-center text-xs text-slate-500">
                            Not enough history yet — trend builds as the agent reports.
                          </p>
                        ) : (
                          <ResponsiveContainer width="100%" height={170}>
                            <AreaChart data={trendData}>
                              <defs>
                                <linearGradient id={`wtot-${gid}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                              <XAxis dataKey="time" stroke="#64748b" fontSize={10} minTickGap={32} />
                              <YAxis stroke="#64748b" fontSize={10} width={36} />
                              <Tooltip content={<WidgetTooltip />} cursor={{ stroke: "#334155" }} />
                              <Area
                                type="monotone"
                                dataKey="total"
                                stroke="#34d399"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill={`url(#wtot-${gid})`}
                                name="Total"
                              />
                              {trendKeys.map((k, i) => (
                                <Line
                                  key={k}
                                  type="monotone"
                                  dataKey={(row: any) => row.groups?.[k] ?? 0}
                                  name={k || "(blank)"}
                                  stroke={groupHex(k, i)}
                                  strokeWidth={2}
                                  dot={false}
                                />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        )
                      ) : groups.length === 0 ? (
                        <p className="py-6 text-center text-xs text-slate-500">No events in this window.</p>
                      ) : (
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-extrabold tracking-tight text-slate-50">
                              {total.toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500">events</span>
                          </div>
                          <div className="mt-2 flex flex-col gap-1.5">
                            {groups.slice(0, 4).map(([label, count], i) => {
                              const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
                              return (
                                <div key={label} className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="truncate font-mono text-slate-300" title={label}>
                                      {label || "(blank)"}
                                    </span>
                                    <span className="ml-2 shrink-0 font-mono text-slate-400">
                                      {count.toLocaleString()} · {pct}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                    <div
                                      className={cn("h-full rounded-full transition-all duration-500", groupColor(label, i))}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="mt-auto flex items-center justify-between border-t border-slate-800/60 pt-2 font-mono text-[10px] text-slate-500">
                        <span>
                          {sample ? widgetRangeLabel(sample) : "no data yet"}
                        </span>
                        {sample && <span>updated {formatTime(sample.received_at)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <SectionHead title="Performance" sub="Resource usage over the selected range" />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">Resource usage</CardTitle>
          <div className="flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.minutes}
                variant={range === r.minutes ? "default" : "ghost"}
                size="sm"
                onClick={() => setRange(r.minutes)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="diskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                domain={[0, (dataMax: number) => Math.min(100, Math.max(10, Math.ceil(dataMax * 1.15)))]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<WidgetTooltip />} cursor={{ stroke: "#334155" }} />
              <Area type="monotone" dataKey="cpu" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#cpuGrad)" name="CPU %" />
              <Area type="monotone" dataKey="memory" stroke="#a78bfa" strokeWidth={2} fillOpacity={1} fill="url(#memGrad)" name="Memory %" />
              <Area type="monotone" dataKey="disk" stroke="#fbbf24" strokeWidth={2} fillOpacity={1} fill="url(#diskGrad)" name="Disk %" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {chartData.length > 1 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Disk I/O Throughput (MB/s)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="readGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="writeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip content={<WidgetTooltip />} cursor={{ stroke: "#334155" }} />
                  <Area type="monotone" dataKey="diskReadRate" stroke="#34d399" strokeWidth={2} fillOpacity={1} fill="url(#readGrad)" name="Read MB/s" />
                  <Area type="monotone" dataKey="diskWriteRate" stroke="#fbbf24" strokeWidth={2} fillOpacity={1} fill="url(#writeGrad)" name="Write MB/s" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Network traffic (MB/s)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="recvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f472b6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f472b6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip content={<WidgetTooltip />} cursor={{ stroke: "#334155" }} />
                  <Area type="monotone" dataKey="sent" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#sentGrad)" name="Sent MB/s" />
                  <Area type="monotone" dataKey="received" stroke="#f472b6" strokeWidth={2} fillOpacity={1} fill="url(#recvGrad)" name="Received MB/s" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}
      </>
      )}

      <SectionHead title="Inventory" sub="Server identity and site context" />
      <Card>
        <CardHeader className="flex-row items-center gap-2 py-3">
          <ServerIcon className="h-4 w-4 text-emerald-400" />
          <CardTitle className="text-sm">Instance details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Server ID</dt>
              <dd className="mt-0.5 truncate font-mono text-sm text-slate-200" title={server.id}>{server.id}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Hostname</dt>
              <dd className="mt-0.5 truncate font-mono text-sm text-slate-200" title={server.hostname}>{server.hostname}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">IP address</dt>
              <dd className="mt-0.5 truncate font-mono text-sm text-slate-200">{server.ip_address ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">State</dt>
              <dd className="mt-1"><StatusBadge status={server.status} /></dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Site</dt>
              <dd className="mt-0.5 truncate text-sm text-slate-200">
                {site ? `${site.client} · ${site.location}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Last seen</dt>
              <dd className="mt-0.5 text-sm text-slate-200">{formatTime(server.last_seen_at)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Services</dt>
              <dd className="mt-0.5 text-sm text-slate-200">
                {runningServices.length}/{enabledServices.length} running
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Devices</dt>
              <dd className="mt-0.5 text-sm text-slate-200">
                {!connectivity ? "Loading…" : `${reachableTargets.length}/${connectivity.length} reachable`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Backups</dt>
              <dd className="mt-0.5 text-sm text-slate-200">
                {!snapMeta ? "Loading…" : `${snapMeta.length} collections`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Check interval</dt>
              <dd className="mt-0.5 font-mono text-sm text-slate-200">
                {agentCfg ? `${agentCfg.monitoring_interval_seconds}s` : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {activeTab === "services" && (
      <Card>
        <CardHeader className="flex-col gap-3">
          <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">Services & ports ({filteredServices.length}/{svcCounts.total})</CardTitle>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                ● {svcCounts.running} running
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">
                ● {svcCounts.stopped} stopped
              </span>
              {svcCounts.disabled > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                  ○ {svcCounts.disabled} disabled
                </span>
              )}
            </div>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddService(!showAddService)}
                className="h-8 gap-1 border-slate-700 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add service
              </Button>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={svcQuery}
                onChange={(e) => { setSvcQuery(e.target.value); setSvcPage(0); }}
                placeholder="Search name or port…"
                className="h-8 w-full rounded-md border border-slate-700 bg-slate-950 pl-8 pr-3 text-xs text-slate-200 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex gap-1">
              {(["all", "running", "stopped", "disabled"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setSvcStatus(f); setSvcPage(0); }}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                    svcStatus === f
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {showAddService && isAdmin && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 p-3">
              <input
                className="h-8 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500"
                placeholder="Service name (e.g. redis, postgres)"
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
              />
              <input
                className="h-8 w-28 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500"
                placeholder="Port (optional)"
                type="number"
                value={newServicePort}
                onChange={(e) => setNewServicePort(e.target.value)}
              />
              <Button size="sm" onClick={() => void addService()} disabled={addingService || !newServiceName.trim()}>
                {addingService ? "Adding..." : "Save service"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddService(false)}>
                Cancel
              </Button>
            </div>
          )}
          <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-800/60">
          <Table>
            <TableHeader className="sticky top-0 bg-slate-900">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Monitoring</TableHead>
                <TableHead>Last checked</TableHead>
                {isAdmin && <TableHead className="w-24"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredServices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5} className="text-slate-500">
                    {services.length === 0 ? "No services reported yet." : "No services match search/filter."}
                  </TableCell>
                </TableRow>
              )}
              {pagedServices.map((s) => {
                const isEnabled = s.enabled ?? true;
                const editing = editingServiceId === s.id;
                return (
                  <TableRow key={s.id} className={!isEnabled ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">
                      {editing ? (
                        <input
                          autoFocus
                          value={editServiceName}
                          onChange={(e) => setEditServiceName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveServiceEdit();
                            if (e.key === "Escape") setEditingServiceId(null);
                          }}
                          className="h-7 w-full min-w-28 rounded-md border border-emerald-600 bg-slate-950 px-2 text-xs text-slate-200 outline-none"
                        />
                      ) : (
                        s.name
                      )}
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <input
                          value={editServicePort}
                          onChange={(e) => setEditServicePort(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveServiceEdit();
                            if (e.key === "Escape") setEditingServiceId(null);
                          }}
                          placeholder="—"
                          type="number"
                          className="h-7 w-20 rounded-md border border-emerald-600 bg-slate-950 px-2 text-xs text-slate-200 outline-none"
                        />
                      ) : (
                        s.port ?? "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <ServiceBadge status={!isEnabled ? "disabled" : s.status} />
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => void toggleServiceEnabled(s)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isEnabled ? "bg-emerald-600" : "bg-slate-700"
                          }`}
                          title={isEnabled ? "Disable monitoring" : "Enable monitoring"}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isEnabled ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">{isEnabled ? "Enabled" : "Disabled"}</span>
                      )}
                    </TableCell>
                    <TableCell>{formatTime(s.last_checked_at)}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        {editing ? (
                          <span className="inline-flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                              onClick={() => void saveServiceEdit()}
                              disabled={savingServiceEdit}
                              title="Save changes (Enter)"
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-slate-400 hover:bg-slate-700/40 hover:text-slate-200"
                              onClick={() => setEditingServiceId(null)}
                              title="Cancel (Esc)"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-slate-400 hover:bg-sky-500/10 hover:text-sky-300"
                              onClick={() => startEditService(s)}
                              title="Edit name / port"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-slate-400 hover:bg-red-500/10 hover:text-red-400"
                              onClick={() => void deleteService(s.id, s.name)}
                              title="Delete service"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          {svcTotalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
              <span>
                Showing {safeSvcPage * SVC_PAGE_SIZE + 1}–
                {Math.min((safeSvcPage + 1) * SVC_PAGE_SIZE, filteredServices.length)} of{" "}
                {filteredServices.length}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={safeSvcPage === 0} onClick={() => setSvcPage(safeSvcPage - 1)}>
                  Prev
                </Button>
                <span className="px-2 py-1 font-mono">
                  {safeSvcPage + 1}/{svcTotalPages}
                </span>
                <Button size="sm" variant="ghost" disabled={safeSvcPage >= svcTotalPages - 1} onClick={() => setSvcPage(safeSvcPage + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}



      {activeTab === "keys" && (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">Agent API keys</CardTitle>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <input
                className="h-8 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs"
                placeholder="key name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <Button size="sm" onClick={createKey}>New key</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {newKey && (
            <div className="rounded-xl border border-emerald-700/80 bg-emerald-950/30 p-4 text-sm flex flex-col gap-3 shadow-md">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Save this API key now — it is shown only once:
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(newKey);
                    showToast({ severity: "info", title: "Key Copied", message: "API key copied to clipboard" });
                  }}
                  className="h-7 text-xs gap-1 text-emerald-300 hover:text-emerald-100"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Key
                </Button>
              </div>
              <code className="block break-all rounded border border-emerald-800 bg-black/60 p-2.5 font-mono text-xs text-emerald-200 select-all">{newKey}</code>
              <div className="mt-1 flex flex-col gap-1.5 border-t border-emerald-800/40 pt-3">
                <span className="text-xs font-medium text-slate-300">Single-Command Agent Installation (Run on Remote Server):</span>
                <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-black/70 p-2 font-mono text-xs text-sky-300">
                  <code className="flex-1 break-all select-all">
                    {`curl -sSL "${(window.location.port === "5173" ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1` : `${window.location.origin}/api/v1`)}/agent/install.sh?server_id=${id}&api_key=${newKey}&api_url=${encodeURIComponent(window.location.port === "5173" ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1` : `${window.location.origin}/api/v1`)}" | sudo bash`}
                  </code>
                  <Button
                    size="sm"
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-7 gap-1"
                    onClick={() => {
                      const effectiveHub = window.location.port === "5173" ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1` : `${window.location.origin}/api/v1`;
                      const cmd = `curl -sSL "${effectiveHub}/agent/install.sh?server_id=${id}&api_key=${newKey}&api_url=${encodeURIComponent(effectiveHub)}" | sudo bash`;
                      navigator.clipboard.writeText(cmd);
                      showToast({ severity: "info", title: "Command Copied", message: "Single-command installer copied to clipboard" });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Command
                  </Button>
                </div>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-slate-500">No keys yet.</TableCell></TableRow>
              )}
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <Badge variant={k.status === "active" ? "green" : "slate"}>{k.status}</Badge>
                  </TableCell>
                  <TableCell>{formatTime(k.created_at)}</TableCell>
                  <TableCell>{formatTime(k.last_used_at)}</TableCell>
                  <TableCell className="flex items-center justify-end gap-2">
                    {isAdmin && k.status === "active" && (
                      <Button variant="destructive" size="sm" onClick={() => void revokeKey(k.id)}>
                        Revoke
                      </Button>
                    )}
                    {isAdmin && k.status === "revoked" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => void deleteKey(k.id)}
                        title="Delete revoked API key"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {serverEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Pencil className="h-4 w-4 text-sky-400" />
                Edit server
              </CardTitle>
              <button
                onClick={() => setServerEditOpen(false)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="-mt-1 text-xs text-slate-500">
              Display name, hostname, IP address and site assignment.
            </p>
            <div className="flex flex-col gap-3 overflow-y-auto pt-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Display name</Label>
                  <input
                    type="text"
                    value={editServerName}
                    onChange={(e) => setEditServerName(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Hostname</Label>
                  <input
                    type="text"
                    value={editServerHostname}
                    onChange={(e) => setEditServerHostname(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">IP address (optional)</Label>
                  <input
                    type="text"
                    value={editServerIp}
                    onChange={(e) => setEditServerIp(e.target.value)}
                    placeholder="no IP"
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Site</Label>
                  <select
                    value={editServerSiteId}
                    onChange={(e) => setEditServerSiteId(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-sky-500"
                  >
                    {allSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.client} · {s.location}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button onClick={() => void saveServerEdit()} disabled={savingServer} size="sm">
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {savingServer ? "Saving…" : "Save server"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setServerEditOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {agentCfgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListChecks className="h-4 w-4 text-emerald-400" />
                Agent runtime settings
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void loadAgentConfig()}>
                  Refresh
                </Button>
                <button
                  onClick={() => setAgentCfgOpen(false)}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="-mt-1 text-xs text-slate-500">
              Centrally managed per-server overrides for this site's agent — no site redeploy needed.
              Agents reflect changes within a few seconds.
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
              <span className="text-xs text-slate-400">From template:</span>
              <select
                value={runtimePick}
                onChange={(e) => setRuntimePick(e.target.value)}
                className="h-8 min-w-40 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value="">
                  {runtimeTemplates === null
                    ? "Loading templates…"
                    : runtimeTemplates.length === 0
                      ? "No templates yet — save one below"
                      : "Choose a template…"}
                </option>
                {(runtimeTemplates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · every {t.monitoring_interval_seconds}s · {t.connectivity_targets.length} targets
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" disabled={!runtimePick} onClick={applyRuntimeTemplate}>
                Apply
              </Button>
              {isAdmin && runtimePick && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                  onClick={() => void deleteRuntimeTemplate()}
                  title="Delete this template from the library"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                <span className="text-xs text-slate-400">Save current as template:</span>
                <input
                  type="text"
                  value={runtimeTplName}
                  onChange={(e) => setRuntimeTplName(e.target.value)}
                  placeholder="e.g. Fast checks"
                  className="h-8 min-w-40 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
                />
                <Button size="sm" variant="ghost" disabled={!runtimeTplName.trim()} onClick={() => void saveAsRuntimeTemplate()}>
                  Save
                </Button>
              </div>
            )}
            <div className="flex flex-col gap-4 overflow-y-auto">
              {!agentCfg ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-slate-400">Interval (s)</Label>
                      <input
                        type="number"
                        min={1}
                        max={3600}
                        disabled={!isAdmin}
                        value={agentCfg.monitoring_interval_seconds}
                        onChange={(e) =>
                          setAgentCfg({ ...agentCfg, monitoring_interval_seconds: Number(e.target.value) })
                        }
                        className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-slate-400">HTTP timeout (s)</Label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        disabled={!isAdmin}
                        value={agentCfg.http_timeout_seconds}
                        onChange={(e) =>
                          setAgentCfg({ ...agentCfg, http_timeout_seconds: Number(e.target.value) })
                        }
                        className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-slate-400">HTTP retries</Label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        disabled={!isAdmin}
                        value={agentCfg.http_retry_count}
                        onChange={(e) =>
                          setAgentCfg({ ...agentCfg, http_retry_count: Number(e.target.value) })
                        }
                        className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-slate-400">Config poll (s)</Label>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        disabled={!isAdmin}
                        value={agentCfg.config_poll_interval_seconds}
                        onChange={(e) =>
                          setAgentCfg({ ...agentCfg, config_poll_interval_seconds: Number(e.target.value) })
                        }
                        className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-slate-400">Connectivity poll (s)</Label>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        disabled={!isAdmin}
                        value={agentCfg.connectivity_poll_interval_seconds}
                        onChange={(e) =>
                          setAgentCfg({ ...agentCfg, connectivity_poll_interval_seconds: Number(e.target.value) })
                        }
                        className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-slate-400">
                      Device connectivity (realtime ping targets — name + IP/Host)
                    </Label>
                    <div className="flex flex-col gap-2">
                      {agentCfg.connectivity_targets.map((t, ti) => (
                        <div key={ti} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                          <span className="w-fit min-w-28 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                            {t.name}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">{t.ip}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!isAdmin}
                            onClick={() =>
                              setAgentCfg({
                                ...agentCfg,
                                connectivity_targets: agentCfg.connectivity_targets.filter((_, i) => i !== ti),
                              })
                            }
                            className="ml-auto h-6 text-xs text-red-400 hover:text-red-300 disabled:opacity-30"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="text"
                            placeholder="name (e.g. PLC device)"
                            value={newTargetName}
                            onChange={(e) => setNewTargetName(e.target.value)}
                            className="h-8 min-w-40 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="IP / host"
                            value={newTargetIp}
                            onChange={(e) => setNewTargetIp(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const name = newTargetName.trim();
                                const ip = newTargetIp.trim();
                                if (!name || !ip) return;
                                setAgentCfg({
                                  ...agentCfg,
                                  connectivity_targets: [...agentCfg.connectivity_targets, { name, ip }],
                                });
                                setNewTargetName("");
                                setNewTargetIp("");
                              }
                            }}
                            className="h-8 min-w-32 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const name = newTargetName.trim();
                              const ip = newTargetIp.trim();
                              if (!name || !ip) return;
                              setAgentCfg({
                                ...agentCfg,
                                connectivity_targets: [...agentCfg.connectivity_targets, { name, ip }],
                              });
                              setNewTargetName("");
                              setNewTargetIp("");
                            }}
                          >
                            Add target
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {isAdmin && (
                    <Button
                      onClick={() => void saveAgentCfg()}
                      disabled={savingCfg}
                      className="mt-1 self-start"
                      size="sm"
                    >
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      {savingCfg ? "Saving…" : "Save agent config"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Config backup settings popup */}
      {backupCfgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4 text-emerald-400" />
                Config backup
              </CardTitle>
              <button
                onClick={() => setBackupCfgOpen(false)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="-mt-1 text-xs text-slate-500">
              Whether the site agent backs up site configuration, which database engine, and which
              collections. The agent reflects changes within a few seconds.
            </p>
            <div className="flex flex-col gap-4 overflow-y-auto">
              {!agentCfg ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex cursor-pointer select-none items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={agentCfg.config_sync_enabled}
                        onChange={(e) => setAgentCfg({ ...agentCfg, config_sync_enabled: e.target.checked })}
                        className="h-4 w-4 accent-emerald-500 disabled:opacity-50"
                      />
                      <span className="text-sm text-slate-300">Backup enabled</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-slate-400">Backup hour (0-23):</Label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        disabled={!isAdmin}
                        value={agentCfg.config_sync_hour}
                        onChange={(e) => setAgentCfg({ ...agentCfg, config_sync_hour: Number(e.target.value) })}
                        className="h-8 w-16 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Label className="text-xs text-slate-400">Database engine:</Label>
                    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => setDbType("mongo")}
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${dbType === "mongo"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "text-slate-400 hover:text-slate-200"
                          }`}
                      >
                        MongoDB
                      </button>
                      <button
                        type="button"
                        disabled
                        title="PostgreSQL backup coming soon"
                        className="cursor-not-allowed rounded-md px-3 py-1 text-xs font-medium text-slate-500"
                      >
                        PostgreSQL (soon)
                      </button>
                    </div>
                  </div>

                  {dbType === "mongo" && (
                    <>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="flex min-w-64 flex-1 flex-col gap-1">
                          <Label className="text-xs text-slate-400">Mongo URI</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={agentCfg.mongo_uri}
                            onChange={(e) => setAgentCfg({ ...agentCfg, mongo_uri: e.target.value })}
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                            placeholder="mongodb://user:pass@localhost:27017"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Auth source</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={agentCfg.mongo_auth_source}
                            onChange={(e) => setAgentCfg({ ...agentCfg, mongo_auth_source: e.target.value })}
                            className="h-8 w-40 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!isAdmin}
                          onClick={() => setAgentCfg({ ...agentCfg, mongo_config_enabled: !agentCfg.mongo_config_enabled })}
                          title="Whether the agent may connect to MongoDB at all"
                          className="mt-5 h-8"
                        >
                          Mongo backup {agentCfg.mongo_config_enabled ? "enabled" : "disabled"}
                        </Button>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-slate-400">
                          Collections to back up (database = collection1, collection2)
                        </Label>
                        <div className="flex flex-col gap-2">
                          {agentCfg.config_collections.map((spec, di) => (
                            <div key={di} className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                              <div className="flex items-center gap-2">
                                <span className="w-fit min-w-40 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                                  {spec.database}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={!isAdmin || agentCfg.config_collections.length <= 1}
                                  onClick={() =>
                                    setAgentCfg({
                                      ...agentCfg,
                                      config_collections: agentCfg.config_collections.filter((_, i) => i !== di),
                                    })
                                  }
                                  className="h-6 text-xs text-red-400 hover:text-red-300 disabled:opacity-30"
                                >
                                  Remove
                                </Button>
                              </div>
                              <input
                                type="text"
                                disabled={!isAdmin}
                                value={spec.collections.join(", ")}
                                onChange={(e) => {
                                  const cols = e.target.value.split(",").map((c) => c.trim()).filter(Boolean);
                                  const next = [...agentCfg.config_collections];
                                  next[di] = { ...spec, collections: cols };
                                  setAgentCfg({ ...agentCfg, config_collections: next });
                                }}
                                className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                              />
                            </div>
                          ))}
                          {isAdmin && (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="new database name"
                                value={newDbName}
                                onChange={(e) => setNewDbName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const name = newDbName.trim();
                                    if (!name) return;
                                    setAgentCfg({
                                      ...agentCfg,
                                      config_collections: [...agentCfg.config_collections, { database: name, collections: [] }],
                                    });
                                    setNewDbName("");
                                  }
                                }}
                                className="h-8 w-1/3 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const name = newDbName.trim();
                                  if (!name) return;
                                  setAgentCfg({
                                    ...agentCfg,
                                    config_collections: [...agentCfg.config_collections, { database: name, collections: [] }],
                                  });
                                  setNewDbName("");
                                }}
                              >
                                Add database
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <Button
                        onClick={() => void testAndRunBackupNow()}
                        disabled={testingBackup || !agentCfg?.mongo_uri}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow"
                        size="sm"
                      >
                        {testingBackup ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-white" />
                        ) : (
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {testingBackup ? (backupProgressText || "Testing & Backing up…") : "Test Connection & Run Backup Now"}
                      </Button>
                      <Button onClick={() => void saveBackupCfg()} disabled={savingBackup} variant="outline" size="sm">
                        <Save className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                        {savingBackup ? "Saving…" : "Save backup config"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}



      {/* Site config backups (snapshots) — grouped by database */}
      {activeTab === "backups" && (
      <Card>
        <CardHeader className="flex-col gap-3">
          <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">
                Site config backups{" "}
                <span className="font-normal text-slate-500">
                  ({backupDbCount} dbs · {backupCollCount} collections)
                </span>
              </CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                Grouped by database — expand a database to see its collections.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { void loadAgentConfig(); setBackupCfgOpen(true); }}>
                <Database className="mr-1 h-4 w-4 text-emerald-400" />
                Backup settings
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void loadSnapshots()}>
                Refresh
              </Button>
              <Button
                size="sm"
                disabled={!snapMeta || snapMeta.length === 0 || !!exporting}
                onClick={() => void downloadAllConfigs()}
              >
                <Download className="mr-1 h-4 w-4" />
                {exporting ?? "Download all (.zip)"}
              </Button>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={backupQuery}
                onChange={(e) => setBackupQuery(e.target.value)}
                placeholder="Search database.collection…"
                className="h-8 w-full rounded-md border border-slate-700 bg-slate-950 pl-8 pr-3 text-xs text-slate-200 outline-none focus:border-emerald-500"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const all: Record<string, boolean> = {};
                for (const g of backupGroups) all[g.database] = true;
                setExpandedDbs(all);
              }}
            >
              Expand all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setExpandedDbs({})}>
              Collapse all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!snapMeta ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : snapMeta.length === 0 ? (
            <p className="text-sm text-slate-500">
              No config snapshots yet — the agent hasn’t synced any site configs.
            </p>
          ) : backupGroups.length === 0 ? (
            <p className="text-sm text-slate-500">
              No backups match “{backupQuery}” — clear the search to see all databases.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {backupGroups.map((group) => {
                const expanded = expandedDbs[group.database] ?? backupGroups.length <= 3;
                return (
                  <div key={group.database} className="overflow-hidden rounded-lg border border-slate-800/70">
                    <button
                      type="button"
                      onClick={() => toggleDb(group.database)}
                      className="flex w-full flex-wrap items-center gap-2 bg-slate-900/60 px-3 py-2 text-left transition-colors hover:bg-slate-800/60"
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <Database className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="font-mono text-xs font-semibold text-slate-200">{group.database}</span>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        {group.items.length} collection{group.items.length === 1 ? "" : "s"}
                      </span>
                      <span className="text-[11px] text-slate-500">{group.totalDocs} docs</span>
                      <span className="ml-auto text-[11px] text-slate-500">
                        last received {formatTime(group.lastReceived)}
                      </span>
                    </button>
                    {expanded && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Collection</TableHead>
                          <TableHead>Docs</TableHead>
                          <TableHead>Captured</TableHead>
                          <TableHead>Received</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((meta) => (
                          <>
                            <TableRow
                              key={meta.id}
                              className={cn("cursor-pointer hover:bg-slate-800/50", expandedSnap === meta.id && "bg-slate-800/40")}
                              onClick={() => toggleView(meta)}
                            >
                              <TableCell className="font-mono text-xs">{meta.collection}</TableCell>
                              <TableCell>{meta.count}{meta.truncated && <span title="truncated"> +…</span>}</TableCell>
                              <TableCell className="text-xs text-slate-400">{formatTime(meta.captured_at)}</TableCell>
                              <TableCell className="text-xs text-slate-400">{formatTime(meta.received_at)}</TableCell>
                              <TableCell className="text-right">
                                <span className="inline-flex gap-1">
                                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); toggleView(meta); }}>
                                    {expandedSnap === meta.id ? "Hide" : loadingSnapDocs === meta.id ? "…" : "View"}
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); void openHistory(meta); }} title="Version history">
                                    <Clock className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); void copySnapshot(meta); }} title="Copy JSON">
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); void downloadSnapshot(meta); }} title="Download JSON">
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </TableCell>
                            </TableRow>
                    {historyFor && historyFor.rowId === meta.id && (
                      <TableRow key={`${meta.id}-history`}>
                        <TableCell colSpan={5} className="bg-black/30 p-0">
                          <div className="border-y border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {meta.database}.{meta.collection} — version history
                          </div>
                          {loadingHistory ? (
                            <div className="space-y-2 p-3">
                              <Skeleton className="h-4 w-full" />
                              <Skeleton className="h-4 w-full" />
                            </div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="pl-6">Received (newest first)</TableHead>
                                  <TableHead>Captured</TableHead>
                                  <TableHead>Docs</TableHead>
                                  <TableHead>Hash</TableHead>
                                  <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {historyItems.map((h) => (
                                  <TableRow key={h.id}>
                                    <TableCell className="pl-6">{formatTime(h.received_at)}</TableCell>
                                    <TableCell>{formatTime(h.captured_at)}</TableCell>
                                    <TableCell>{h.count}{h.truncated && " +"}</TableCell>
                                    <TableCell className="font-mono text-xs text-slate-500">{h.content_hash.slice(0, 10)}</TableCell>
                                    <TableCell className="text-right">
                                      <span className="inline-flex gap-1">
                                        <Button variant="ghost" size="sm" onClick={() => toggleView(h)}>View</Button>
                                        <Button variant="ghost" size="sm" onClick={() => void downloadSnapshot(h)} title={`Download ${h.database}.${h.collection}.json`}>
                                          <Download className="h-3.5 w-3.5" />
                                        </Button>
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {expandedSnap === meta.id && (
                      <TableRow key={`${meta.id}-json`}>
                        <TableCell colSpan={5} className="p-0">
                          <div className="flex items-center justify-between border-y border-slate-800 bg-black/50 px-3 py-1.5">
                            <span className="font-mono text-[11px] text-slate-500">
                              {meta.database}.{meta.collection}.json · {meta.count} documents
                              {meta.truncated && " (truncated)"}
                            </span>
                            <button
                              onClick={async () => {
                                const docs = await fetchSnapshotDocuments(meta.id);
                                await navigator.clipboard.writeText(JSON.stringify(docs, null, 2));
                                showToast({ severity: "info", title: "Copied" });
                              }}
                              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                            >
                              <Copy className="h-3 w-3" /> Copy
                            </button>
                          </div>
                          <pre className="max-h-96 overflow-auto bg-black/60 p-4 font-mono text-[11px] leading-relaxed text-emerald-200/90">
                            {loadingSnapDocs === meta.id
                              ? "Loading documents…"
                              : JSON.stringify(snapDocs[meta.id] ?? [], null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                          </>
                        ))}
                      </TableBody>
                    </Table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Logs Section (Site Slave Logs & Agent Runtime Logs) */}
      {activeTab === "logs" && (
        <div className="flex flex-col gap-4">
          {/* Main Logs Header & Sub-Tab Switcher */}
          <Card className="border-slate-800/80 bg-slate-900/60 shadow-xl">
            <CardHeader className="p-4 border-b border-slate-800/80">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-sky-400" />
                    <CardTitle className="text-base font-bold text-slate-100">
                      {logsSubTab === "site_slave_logs" ? "Site Slave Logs & Incident History" : "Agent Execution & Runtime Logs"}
                    </CardTitle>
                    <Badge variant="blue" className="ml-1 border-sky-500/30 bg-sky-500/10 text-sky-300 font-mono text-[11px]">
                      {logsSubTab === "site_slave_logs" ? `${siteAlerts.length} site logs` : `${agentLogTotal} recorded`}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {logsSubTab === "site_slave_logs" ? (
                      <>
                        Real-time incident alerts, warnings, and auto-resolutions for{" "}
                        <span className="font-semibold text-slate-200">{site?.client || "Site"}</span>
                        {" · "}
                        <span className="text-sky-300 font-medium">{site?.location || "Current Site"}</span>
                        {site?.code && <span className="ml-1.5 font-mono text-slate-500">[{site.code}]</span>}
                      </>
                    ) : (
                      "Real-time host activity logs, telemetry dispatches, config backups, and service checks from this server agent."
                    )}
                  </p>
                </div>

                {/* Sub-Tab Switcher */}
                <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => setLogsSubTab("site_slave_logs")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                      logsSubTab === "site_slave_logs"
                        ? "bg-sky-600 font-bold text-white shadow-md shadow-sky-500/20"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Site Slave Logs
                    <span className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                      logsSubTab === "site_slave_logs" ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400"
                    )}>
                      {siteAlerts.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogsSubTab("agent_runtime")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                      logsSubTab === "agent_runtime"
                        ? "bg-sky-600 font-bold text-white shadow-md shadow-sky-500/20"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Agent Runtime Logs
                    <span className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                      logsSubTab === "agent_runtime" ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400"
                    )}>
                      {agentLogTotal}
                    </span>
                  </button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* VIEW 1: Site Slave Logs */}
          {logsSubTab === "site_slave_logs" && (
            <div className="space-y-4">
              {/* Site Incident Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="border-red-500/30 bg-slate-900/90 shadow-sm">
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Critical</span>
                      <div className="text-xl font-extrabold text-red-400 mt-0.5">{siteCriticalCount}</div>
                    </div>
                    <div className="p-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
                      <ShieldAlert className="h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-amber-500/30 bg-slate-900/90 shadow-sm">
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Warnings</span>
                      <div className="text-xl font-extrabold text-amber-400 mt-0.5">{siteWarningCount}</div>
                    </div>
                    <div className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-sky-500/30 bg-slate-900/90 shadow-sm">
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Active Incidents</span>
                      <div className="text-xl font-extrabold text-sky-400 mt-0.5">{siteActiveCount}</div>
                    </div>
                    <div className="p-2 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
                      <Activity className="h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-emerald-500/30 bg-slate-900/90 shadow-sm">
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Auto-Resolved</span>
                      <div className="text-xl font-extrabold text-emerald-400 mt-0.5">{siteResolvedCount}</div>
                    </div>
                    <div className="p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Filter controls toolbar */}
              <Card className="border-slate-800/80 bg-slate-900/60 shadow-md">
                <CardContent className="p-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Scope toggle: Entire Site vs This Node */}
                    <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                      <button
                        type="button"
                        onClick={() => setSiteAlertsScope("site")}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition-all flex items-center gap-1.5",
                          siteAlertsScope === "site" ? "bg-sky-600 font-bold text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                        )}
                      >
                        <Building2 className="h-3 w-3" />
                        Entire Site ({site?.location || site?.code || "Site"})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSiteAlertsScope("server")}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition-all flex items-center gap-1.5",
                          siteAlertsScope === "server" ? "bg-sky-600 font-bold text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                        )}
                      >
                        <ServerIcon className="h-3 w-3" />
                        This Node ({server.name})
                      </button>
                    </div>

                    {/* Status filter: all / active / resolved */}
                    <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                      {(["all", "active", "resolved"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setSiteAlertsFilter(f)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-all capitalize",
                            siteAlertsFilter === f ? "bg-sky-600 font-bold text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          {f}
                        </button>
                      ))}
                    </div>

                    {/* Severity filter: all / critical / warning / info */}
                    <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                      {(["all", "critical", "warning", "info"] as const).map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => setSiteAlertsSeverity(sev)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-all capitalize",
                            siteAlertsSeverity === sev ? "bg-sky-600 font-bold text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          {sev}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Search input */}
                    <div className="relative flex-1 sm:w-64">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search site logs..."
                        value={siteAlertsSearch}
                        onChange={(e) => setSiteAlertsSearch(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-700/60 bg-slate-950 pl-8 pr-7 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-sky-500/60 font-mono"
                      />
                      {siteAlertsSearch && (
                        <button
                          type="button"
                          onClick={() => setSiteAlertsSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        loadSiteAlerts();
                        showToast({ severity: "info", title: "Refreshed", message: "Site slave logs refreshed" });
                      }}
                      disabled={siteAlertsLoading}
                      className="h-8 gap-1 text-xs"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", siteAlertsLoading && "animate-spin")} />
                      Refresh
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Slave Logs Table */}
              <Card className="border-slate-800/80 bg-slate-900/60 shadow-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-slate-800/80 bg-slate-950/80 hover:bg-slate-950/80">
                      <TableHead className="w-24">Severity</TableHead>
                      <TableHead className="w-48">Slave / Node</TableHead>
                      <TableHead>Incident Log Message</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead className="w-36">Triggered</TableHead>
                      <TableHead className="w-56">Auto-Resolution State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {siteAlertsLoading && siteAlerts.length === 0 ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full max-w-[160px]" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : filteredSiteAlerts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12 text-center text-slate-500">
                          <ShieldAlert className="mx-auto h-8 w-8 text-slate-600 mb-2 opacity-50" />
                          <p className="font-semibold text-slate-400">No slave logs for this site</p>
                          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                            No incident logs match the criteria for this site ({site?.client} · {site?.location}).
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSiteAlerts.map((a) => {
                        const srv = serverMap[a.server_id] || (server.id === a.server_id ? server : undefined);
                        const isCurrent = a.server_id === id;
                        return (
                          <TableRow key={a.id} className={cn("hover:bg-slate-800/40 transition-colors", isCurrent && "bg-sky-500/[0.02]")}>
                            <TableCell>
                              <SeverityBadge severity={a.severity} />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col leading-tight">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-slate-200 text-xs">
                                    {srv ? srv.name : a.server_id.slice(0, 8)}
                                  </span>
                                  {isCurrent && (
                                    <span className="rounded bg-sky-500/20 text-sky-300 px-1 py-0.1 text-[9px] font-mono border border-sky-500/30">
                                      this node
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-slate-500 font-mono">
                                  {srv?.hostname || "—"}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-200">
                              {a.message}
                            </TableCell>
                            <TableCell>
                              <Badge variant={a.status === "active" ? "red" : "green"}>{a.status}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-slate-400 font-mono">
                              {formatTime(a.created_at)}
                            </TableCell>
                            <TableCell>
                              {a.status === "resolved" ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                  Auto-Resolved {a.resolved_at ? `(${formatTime(a.resolved_at)})` : ""}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                                  <Activity className="h-3.5 w-3.5 text-amber-400 shrink-0 animate-pulse" />
                                  Active (Auto-Monitoring)
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* VIEW 2: Agent Runtime Logs */}
          {logsSubTab === "agent_runtime" && (
            <Card className="border-slate-800/80 bg-slate-900/60 shadow-xl">
              <CardHeader className="flex flex-col gap-4 border-b border-slate-800/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-sky-400" />
                    <CardTitle className="text-base font-bold text-slate-100">
                      Agent Execution & Runtime Logs
                    </CardTitle>
                    <Badge variant="blue" className="ml-1 border-sky-500/30 bg-sky-500/10 text-sky-300 font-mono text-[11px]">
                      {agentLogTotal} recorded
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    Real-time activity logs, telemetry dispatches, config backups, and service checks from this server agent.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Agent log scope selector */}
                  <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                    <button
                      type="button"
                      onClick={() => setAgentLogsScope("server")}
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-medium transition-all",
                        agentLogsScope === "server" ? "bg-sky-600 font-bold text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      This Server
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgentLogsScope("site")}
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-medium transition-all",
                        agentLogsScope === "site" ? "bg-sky-600 font-bold text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      Entire Site
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setLogAutoRefresh(!logAutoRefresh)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all",
                      logAutoRefresh
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 shadow-sm shadow-emerald-500/10"
                        : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                    )}
                    title={logAutoRefresh ? "Pause live stream" : "Enable live stream"}
                  >
                    <span className={cn("h-2 w-2 rounded-full", logAutoRefresh ? "bg-emerald-400 animate-pulse" : "bg-slate-500")} />
                    Live Stream {logAutoRefresh ? "(5s)" : "(Paused)"}
                  </button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFetchJournal}
                    disabled={fetchingJournal}
                    className="gap-1.5 border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 hover:text-sky-200 text-xs"
                  >
                    {fetchingJournal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TerminalSquare className="h-3.5 w-3.5" />}
                    Fetch Host Journal
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      loadAgentLogs();
                      showToast({ severity: "info", title: "Refreshed", message: "Agent logs refreshed" });
                    }}
                    disabled={loadingLogs}
                    className="gap-1 text-xs"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", loadingLogs && "animate-spin")} />
                    Refresh
                  </Button>

                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearLogs}
                      className="gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-4">
                {/* Filter bar & Quick Actions */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Level selector */}
                    <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                      {(["all", "info", "warning", "error"] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setLogLevel(lvl)}
                          className={cn(
                            "rounded-md px-2.5 py-0.5 text-xs font-medium transition-all capitalize",
                            logLevel === lvl
                              ? "bg-sky-600 font-bold text-white shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>

                    {/* Search query */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search logs by keyword..."
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        className="h-8 rounded-lg border border-slate-700/60 bg-slate-900/90 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-sky-500/60 w-56 sm:w-64 font-mono"
                      />
                      {logSearch && (
                        <button
                          type="button"
                          onClick={() => setLogSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const text = agentLogs
                          .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source || "agent"}] ${l.message}`)
                          .join("\n");
                        await navigator.clipboard.writeText(text);
                        showToast({ severity: "info", title: "Copied", message: `Copied ${agentLogs.length} log lines to clipboard` });
                      }}
                      className="gap-1.5 text-xs text-slate-400 hover:text-slate-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy Visible
                    </Button>
                  </div>
                </div>

                {/* Optional Host Systemd Journal Collapsible */}
                {journalOpen && journalOutput && (
                  <div className="rounded-xl border border-sky-500/30 bg-slate-950 p-3 shadow-lg">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-sky-400" />
                        <span className="text-xs font-bold text-sky-300">
                          Host Systemd Service Journal (journalctl)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(journalOutput);
                            showToast({ severity: "info", title: "Copied Journal" });
                          }}
                          className="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        >
                          <Copy className="h-3 w-3 inline mr-1" /> Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => setJournalOpen(false)}
                          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <pre className="max-h-64 overflow-auto rounded bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                      {journalOutput}
                    </pre>
                  </div>
                )}

                {/* Main Log Console Stream */}
                <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/95 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <div className="flex items-center gap-4">
                      <span className="w-32">Timestamp (UTC)</span>
                      <span className="w-16">Level</span>
                      <span className="w-20">Source</span>
                      <span>Event Message</span>
                    </div>
                    <div>{agentLogs.length} entries shown</div>
                  </div>

                  <div className="max-h-[560px] overflow-y-auto p-2 font-mono text-xs divide-y divide-slate-900/80 space-y-1">
                    {loadingLogs && agentLogs.length === 0 ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-4 py-2 px-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-4 flex-1" />
                        </div>
                      ))
                    ) : agentLogs.length === 0 ? (
                      <div className="py-12 text-center text-slate-500">
                        <FileText className="mx-auto h-8 w-8 text-slate-600 mb-2 opacity-50" />
                        <p className="font-semibold text-slate-400">No agent logs recorded yet</p>
                        <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                          Logs will stream automatically as the agent pushes metrics and performs background checks. You can also click &ldquo;Fetch Host Journal&rdquo; to pull the remote host systemd logs directly.
                        </p>
                      </div>
                    ) : (
                      agentLogs.map((log) => {
                        const lvl = (log.level || "info").toLowerCase();
                        const isErr = lvl === "error";
                        const isWarn = lvl === "warning" || lvl === "warn";

                        return (
                          <div
                            key={log.id}
                            className={cn(
                              "flex items-start gap-4 rounded px-2.5 py-1.5 transition-colors hover:bg-slate-900/70",
                              isErr && "bg-red-950/20 text-red-200",
                              isWarn && "bg-amber-950/20 text-amber-200"
                            )}
                          >
                            <span className="w-32 shrink-0 text-[11px] text-slate-500">
                              {log.timestamp ? formatTime(log.timestamp) : "—"}
                            </span>

                            <span className="w-16 shrink-0">
                              <span
                                className={cn(
                                  "inline-block rounded px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider",
                                  isErr
                                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                    : isWarn
                                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                    : "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                )}
                              >
                                {lvl}
                              </span>
                            </span>

                            <span className="w-20 shrink-0 text-[11px] text-slate-400 truncate">
                              {log.source || "agent"}
                            </span>

                            <span className="flex-1 break-words font-mono text-slate-200 leading-relaxed text-[11px]">
                              {log.message}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}



    </div>
  );
}