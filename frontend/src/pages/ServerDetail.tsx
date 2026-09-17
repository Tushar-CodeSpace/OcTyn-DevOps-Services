import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Bell, Building2, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Database, Download, FileSpreadsheet, LayoutGrid, Loader2, MapPin, MinusCircle, Play, Plus, RefreshCw, Save, Search, Server as ServerIcon, ShieldCheck, ListChecks, Settings2, Terminal, Trash2, X, XCircle } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
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
import type { AgentConfig, Alert, ApiKey, ConfigSnapshotFull, ConfigSnapshotMeta, ConnectivityStatus, CustomWidgetSpec, Metric, Server, Service, Site, WidgetHistoryPoint, WidgetSample } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServiceBadge, StatusBadge } from "@/components/StatusBadge";
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
  const { isAdmin, isSuperAdmin } = useAuth();
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

  // Tabbed layout + compact filter state (handy with many ports / backups)
  const [activeTab, setActiveTab] = useState<"overview" | "services" | "widgets" | "backups" | "keys">("overview");
  const [svcQuery, setSvcQuery] = useState("");
  const [svcStatus, setSvcStatus] = useState<"all" | "running" | "stopped" | "disabled">("all");
  const [svcPage, setSvcPage] = useState(0);
  const [backupQuery, setBackupQuery] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  // Collapsible overview sections (null = auto: expand only when attention needed)
  const [healthOpen, setHealthOpen] = useState<boolean | null>(null);
  const [connOpen, setConnOpen] = useState<boolean | null>(null);
  const SVC_PAGE_SIZE = 10;

  // Custom data widgets (agent-pushed MongoDB tallies)
  const [widgets, setWidgets] = useState<WidgetSample[] | null>(null);
  const [widgetCfgOpen, setWidgetCfgOpen] = useState(false);
  const [widgetDraft, setWidgetDraft] = useState<CustomWidgetSpec[]>([]);
  const [savingWidgets, setSavingWidgets] = useState(false);
  // Per-widget overview chart mode (bar/pie/trend), persisted per server
  type WidgetChartMode = "bar" | "pie" | "trend";
  const chartStoreKey = `octyn:widget-charts:${id ?? "unknown"}`;
  const [widgetChart, setWidgetChart] = useState<Record<string, WidgetChartMode>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(chartStoreKey) ?? "{}") as Record<string, string>;
      const clean: Record<string, WidgetChartMode> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v === "bar" || v === "pie" || v === "trend") clean[k] = v;
      }
      return clean;
    } catch {
      return {};
    }
  });
  const [widgetHistory, setWidgetHistory] = useState<Record<string, WidgetHistoryPoint[]>>({});
  const [loadingHist, setLoadingHist] = useState<Record<string, boolean>>({});
  // Refs so the socket handler (stable closure) sees current chart modes
  const chartModeRef = useRef(widgetChart);
  chartModeRef.current = widgetChart;

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
    const [s, svc, k, sites] = await Promise.all([
      apiFetch<Server>(`/servers/${id}`),
      apiFetch<Service[]>(`/servers/${id}/services`),
      apiFetch<ApiKey[]>(`/servers/${id}/api-keys`),
      apiFetch<Site[]>("/sites"),
    ]);
    setSite(sites.find((x) => x.id === s.site_id) ?? null);
    setServer(s);
    setServices(svc);
    setKeys(k);
    apiFetch<Alert[]>(`/alerts?server_id=${id}&status=active&limit=20`)
      .then(setAlerts)
      .catch(() => setAlerts([]));
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

  async function saveAgentCfg() {
    if (!id || !agentCfg) return;
    setSavingCfg(true);
    try {
      const saved = await apiFetch<AgentConfig>(`/agent-config/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          monitored_services: agentCfg.monitored_services,
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

  function pickChart(name: string, mode: "bar" | "pie" | "trend") {
    setWidgetChart((prev) => {
      const next = { ...prev, [name]: mode };
      try {
        localStorage.setItem(chartStoreKey, JSON.stringify(next));
      } catch {
        /* private mode etc. */
      }
      return next;
    });
    if (mode === "trend") void loadWidgetHistory(name);
  }

  function openWidgetCfg() {
    setWidgetDraft(
      (agentCfg?.custom_widgets ?? []).map((w) => ({ ...w }))
    );
    setWidgetCfgOpen(true);
  }

  async function saveWidgetCfg() {
    if (!id) return;
    setSavingWidgets(true);
    try {
      const saved = await apiFetch<AgentConfig>(`/agent-config/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ custom_widgets: widgetDraft }),
      });
      setAgentCfg(saved);
      showToast({
        severity: "info",
        title: "Widgets saved",
        message: "The site agent will pick up widget changes within a few seconds.",
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Save failed",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSavingWidgets(false);
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

  function groupColor(label: string): string {
    const l = label.toLowerCase();
    if (/(success|^ok$|passed|complete)/.test(l)) return "bg-emerald-500";
    if (/(fail|error|expired|invalid|reject)/.test(l)) return "bg-red-500";
    if (/(pending|retry|warn|unknown)/.test(l)) return "bg-amber-500";
    return "bg-sky-500";
  }

  function groupHex(label: string): string {
    const l = label.toLowerCase();
    if (/(success|^ok$|passed|complete)/.test(l)) return "#34d399";
    if (/(fail|error|expired|invalid|reject)/.test(l)) return "#f87171";
    if (/(pending|retry|warn|unknown)/.test(l)) return "#fbbf24";
    return "#38bdf8";
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
    const onWidgetUpdate = (d: WidgetSample & { server_id: string }) => {
      if (d.server_id !== id) return;
      setWidgets((prev) => {
        const next = (prev ?? []).filter((w) => w.widget_name !== d.widget_name);
        return [d, ...next];
      });
      // Drop cached trend so it refetches fresh on next view; refetch now if visible
      setWidgetHistory((prev) => {
        if (!(d.widget_name in prev)) return prev;
        const next = { ...prev };
        delete next[d.widget_name];
        return next;
      });
      if (chartModeRef.current[d.widget_name] === "trend") void loadWidgetHistory(d.widget_name, true);
    };

    socket.on("metric", onMetric);
    socket.on("service_update", onServiceUpdate);
    socket.on("server_status", onStatus);
    socket.on("server_updated", onServerUpdated);
    socket.on("connectivity", onConnectivity);
    socket.on("config_snapshot", onConfigSnapshot);
    socket.on("widget_update", onWidgetUpdate);
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
      socket.off("widget_update", onWidgetUpdate);
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
  const apiErrRate = latest?.api_error_rate_percent ?? 0;

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

          {isSuperAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/servers/${id}/terminal`, "_blank", "noopener,noreferrer")}
              title="Open a super-admin terminal for this site server"
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
            { id: "widgets", label: `Widgets (${widgets?.length ?? 0})` },
            { id: "backups", label: `Backups (${backupCollCount})` },
            { id: "keys", label: `Keys (${keys.length})` },
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

      <Card className="overflow-hidden">
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
            <Activity className="h-4 w-4 shrink-0 text-emerald-400" />
            <CardTitle className="text-xs font-semibold text-slate-200">Device connectivity</CardTitle>
          </button>
          <span className="font-mono text-[11px] text-slate-500">
            {!connectivity
              ? "loading…"
              : connectivity.length === 0
                ? "no targets"
                : connUnreachable > 0
                  ? `${connUnreachable} offline · ${reachableTargets.length}/${connectivity.length} reachable`
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
                  className="flex flex-col justify-between rounded-lg border border-slate-800/80 bg-slate-950/60 p-2 transition-all duration-200 hover:border-slate-700/80"
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {c.reachable === null ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500" />
                      ) : c.reachable ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]" />
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
                          : "text-red-400"
                      }`}
                    >
                      {c.reachable === null
                        ? "—"
                        : c.reachable
                        ? c.latency_ms != null
                          ? `${c.latency_ms}ms`
                          : "OK"
                        : "OFFLINE"}
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
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">API health</p>
              <p className={cn("mt-0.5 truncate font-mono text-sm", apiErrRate > 5 ? "text-red-400" : apiErrRate > 0 ? "text-amber-400" : "text-emerald-400")}>
                {latest ? `${apiErrRate.toFixed(1)}% err` : "—"} · 4xx {latest?.api_requests_4xx ?? 0} / 5xx {latest?.api_requests_5xx ?? 0}
              </p>
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
        const seen = new Set((widgets ?? []).map((s) => s.widget_name));
        const entries: { def?: CustomWidgetSpec; sample?: WidgetSample }[] = [
          ...(widgets ?? []).map((s) => ({ sample: s, def: defByName.get(s.widget_name) })),
          ...defs.filter((d) => !seen.has(d.name)).map((d) => ({ def: d })),
        ];
        if (entries.length === 0) return null;
        return (
          <Card>
            <CardHeader className="flex-col gap-1">
              <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">Data widgets ({entries.length})</CardTitle>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Live tallies from the site agent — pick Bar, Pie or Trend per widget.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("widgets")}>
                  Manage widgets
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map(({ def, sample }) => {
                  const name = sample?.widget_name ?? def?.name ?? "?";
                  const gid = name.replace(/[^A-Za-z0-9_-]/g, "_");
                  const mode = widgetChart[name] ?? "bar";
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
                  const failedKey = Object.keys(hist[0]?.groups ?? sample?.groups ?? {}).find((k) =>
                    /fail|error/i.test(k)
                  );
                  const trendData = hist.map((p) => ({
                    time: new Date(p.received_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    total: p.total,
                    failed: failedKey ? (p.groups[failedKey] ?? 0) : 0,
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
                              : `${def?.database}.${def?.collection} · every ${def?.poll_interval_seconds ?? 60}s`}
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

                      <div className="inline-flex self-start rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                        {(["bar", "pie", "trend"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => pickChart(name, m)}
                            className={cn(
                              "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                              mode === m
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "text-slate-400 hover:text-slate-200"
                            )}
                          >
                            {m === "trend" ? "Trend" : m === "pie" ? "Pie" : "Bars"}
                          </button>
                        ))}
                      </div>

                      {!sample ? (
                        <p className="py-6 text-center text-xs text-slate-500">
                          Waiting for the agent's first tally…
                        </p>
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
                                  {pieData.map((d) => (
                                    <Cell key={d.name} fill={groupHex(d.name)} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px" }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                              {pieData.map((d) => (
                                <span key={d.name} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ background: groupHex(d.name) }}
                                  />
                                  {d.name} · {d.value.toLocaleString()}
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
                              <Tooltip
                                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px" }}
                              />
                              <Area
                                type="monotone"
                                dataKey="total"
                                stroke="#34d399"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill={`url(#wtot-${gid})`}
                                name="Total"
                              />
                              {failedKey && (
                                <Area
                                  type="monotone"
                                  dataKey="failed"
                                  stroke="#f87171"
                                  strokeWidth={2}
                                  fillOpacity={0}
                                  name={failedKey}
                                />
                              )}
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
                            {groups.slice(0, 4).map(([label, count]) => {
                              const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
                              return (
                                <div key={label} className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="truncate font-mono text-slate-300" title={label}>
                                      {label}
                                    </span>
                                    <span className="ml-2 shrink-0 font-mono text-slate-400">
                                      {count.toLocaleString()} · {pct}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                    <div
                                      className={cn("h-full rounded-full transition-all duration-500", groupColor(label))}
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
                          {sample ? `total ${total.toLocaleString()} · updated ${formatTime(sample.received_at)}` : "no data yet"}
                        </span>
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
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px" }} />
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
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px" }} />
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
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px" }} />
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
                {isAdmin && <TableHead className="w-12"></TableHead>}
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
                return (
                  <TableRow key={s.id} className={!isEnabled ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.port ?? "—"}</TableCell>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => void deleteService(s.id, s.name)}
                          title="Delete service"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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

      {activeTab === "widgets" && (
      <Card>
        <CardHeader className="flex-col gap-2">
          <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">
                Custom data widgets{widgets ? ` (${widgets.length})` : ""}
              </CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                Periodic tallies collected by the site agent from site MongoDB
                (e.g. upload SUCCESS vs FAILED per minute).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { void loadAgentConfig(); openWidgetCfg(); }}>
                <LayoutGrid className="mr-1 h-4 w-4 text-emerald-400" />
                Configure widgets
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void loadWidgets()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!widgets ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full rounded-xl" />
              ))}
            </div>
          ) : widgets.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-slate-700/80 bg-slate-950/40 p-6">
              <p className="text-sm text-slate-400">
                No widgets yet — the agent hasn't reported any tallies.
              </p>
              <p className="text-xs text-slate-500">
                Click <span className="font-semibold text-slate-300">Configure widgets</span> to
                add one, e.g. count <span className="font-mono">data_uploader_service.integration_logs</span> grouped
                by <span className="font-mono">upload_status</span> every 60s.
              </p>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => { void loadAgentConfig(); openWidgetCfg(); }}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add widget
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {widgets.map((w) => {
                const state = widgetState(w);
                const entries = Object.entries(w.groups ?? {}).sort((a, b) => b[1] - a[1]);
                return (
                  <div
                    key={w.widget_name}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border bg-slate-950/40 p-4",
                      state === "error"
                        ? "border-red-500/40"
                        : state === "stale"
                          ? "border-amber-500/30"
                          : "border-slate-800/70"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100" title={w.widget_name}>
                          {w.widget_name}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={`${w.database}.${w.collection}`}>
                          {w.database}.{w.collection} · last {w.window_minutes}m
                        </p>
                      </div>
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
                    </div>

                    {w.error ? (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                        Agent reported: {w.error}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-extrabold tracking-tight text-slate-50">
                            {w.total.toLocaleString()}
                          </span>
                          <span className="text-xs text-slate-500">events</span>
                        </div>
                        {entries.length === 0 ? (
                          <p className="text-xs text-slate-500">No events in this window.</p>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {entries.map(([label, count]) => {
                              const pct = w.total > 0 ? Math.min(100, Math.round((count / w.total) * 100)) : 0;
                              return (
                                <div key={label} className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="truncate font-mono text-slate-300" title={label}>
                                      {label}
                                    </span>
                                    <span className="ml-2 shrink-0 font-mono text-slate-400">
                                      {count.toLocaleString()} · {pct}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                    <div
                                      className={cn("h-full rounded-full transition-all duration-500", groupColor(label))}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                    <div className="mt-auto flex items-center justify-between border-t border-slate-800/60 pt-2 font-mono text-[10px] text-slate-500">
                      <span>collected {formatTime(w.collected_at)}</span>
                      <span>every {widgetIntervalSeconds(w.widget_name)}s</span>
                    </div>
                  </div>
                );
              })}
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
            <div className="rounded-md border border-emerald-700 bg-emerald-900/30 p-3 text-sm">
              <p className="font-medium text-emerald-300">Save this key now — it is shown only once:</p>
              <code className="mt-1 block break-all text-emerald-100">{newKey}</code>
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

      {/* Custom widget configuration popup */}
      {widgetCfgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <LayoutGrid className="h-4 w-4 text-emerald-400" />
                Custom data widgets
              </CardTitle>
              <button
                onClick={() => setWidgetCfgOpen(false)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="-mt-1 text-xs text-slate-500">
              The site agent counts documents in the given database + collection over a
              rolling window and pushes SUCCESS / FAILED style tallies every interval.
              Needs site MongoDB access (same URI as config backup) + pymongo on the host.
            </p>
            <div className="flex flex-col gap-3 overflow-y-auto">
              {!agentCfg ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <>
                  {widgetDraft.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-700/80 p-4 text-xs text-slate-500">
                      No widgets configured. Add one below — e.g. name{" "}
                      <span className="font-mono text-slate-300">Inscan uploads</span>, database{" "}
                      <span className="font-mono text-slate-300">data_uploader_service</span>, collection{" "}
                      <span className="font-mono text-slate-300">integration_logs</span>, group by{" "}
                      <span className="font-mono text-slate-300">upload_status</span>.
                    </p>
                  )}
                  {widgetDraft.map((w, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Name</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={w.name}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, name: e.target.value };
                              setWidgetDraft(next);
                            }}
                            placeholder="Inscan uploads"
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Database</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={w.database}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, database: e.target.value };
                              setWidgetDraft(next);
                            }}
                            placeholder="data_uploader_service"
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Collection</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={w.collection}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, collection: e.target.value };
                              setWidgetDraft(next);
                            }}
                            placeholder="integration_logs"
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Every (s)</Label>
                          <input
                            type="number"
                            min={1}
                            max={3600}
                            disabled={!isAdmin}
                            value={w.poll_interval_seconds}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, poll_interval_seconds: Number(e.target.value) };
                              setWidgetDraft(next);
                            }}
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Window (min)</Label>
                          <input
                            type="number"
                            min={1}
                            max={10080}
                            disabled={!isAdmin}
                            value={w.window_minutes}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, window_minutes: Number(e.target.value) };
                              setWidgetDraft(next);
                            }}
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Group by field</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={w.group_by_field}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, group_by_field: e.target.value };
                              setWidgetDraft(next);
                            }}
                            placeholder="upload_status"
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-slate-400">Time field</Label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={w.time_field}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, time_field: e.target.value };
                              setWidgetDraft(next);
                            }}
                            placeholder="created_at"
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex cursor-pointer select-none items-center gap-2">
                          <input
                            type="checkbox"
                            disabled={!isAdmin}
                            checked={w.enabled}
                            onChange={(e) => {
                              const next = [...widgetDraft];
                              next[i] = { ...w, enabled: e.target.checked };
                              setWidgetDraft(next);
                            }}
                            className="h-4 w-4 accent-emerald-500 disabled:opacity-50"
                          />
                          <span className="text-xs text-slate-300">Enabled</span>
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!isAdmin}
                          onClick={() => setWidgetDraft(widgetDraft.filter((_, j) => j !== i))}
                          className="h-7 text-xs text-red-400 hover:text-red-300 disabled:opacity-30"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setWidgetDraft([
                            ...widgetDraft,
                            {
                              name: "",
                              database: "",
                              collection: "",
                              enabled: true,
                              poll_interval_seconds: 60,
                              window_minutes: 60,
                              group_by_field: "upload_status",
                              time_field: "created_at",
                              max_groups: 10,
                            },
                          ])
                        }
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add widget
                      </Button>
                      <Button onClick={() => void saveWidgetCfg()} disabled={savingWidgets} size="sm">
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        {savingWidgets ? "Saving…" : "Save widgets"}
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
    </div>
  );
}