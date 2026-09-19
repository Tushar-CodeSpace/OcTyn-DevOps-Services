import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { showToast } from "@/components/ToastHost";
import type {
  MasterCleanupResult,
  MasterMetricsHistoryPoint,
  MasterServerStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}d ${remH}h`;
}

export default function MasterServerPage() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<MasterServerStatus | null>(null);
  const [history, setHistory] = useState<MasterMetricsHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(10);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Cleanup Modal State
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<MasterCleanupResult | null>(null);

  // Search collection table
  const [collectionSearch, setCollectionSearch] = useState("");

  useEffect(() => {
    fetchMasterData();
  }, []);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchMasterData(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval]);

  async function fetchMasterData(isBackground = false) {
    if (!isBackground) setLoading(true);
    else setRefreshing(true);

    try {
      const [statusRes, historyRes] = await Promise.all([
        apiFetch<MasterServerStatus>("/master-server/status"),
        apiFetch<MasterMetricsHistoryPoint[]>("/master-server/history").catch(() => []),
      ]);
      setStatus(statusRes);
      setHistory(historyRes);
      setLastUpdated(new Date());
    } catch (err) {
      if (!isBackground) {
        showToast({
          severity: "critical",
          title: "Failed to load master telemetry",
          message: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function runRetentionCleanup() {
    setCleaning(true);
    try {
      const res = await apiFetch<MasterCleanupResult>("/master-server/cleanup", {
        method: "POST",
      });
      setCleanupResult(res);
      showToast({
        severity: "info",
        title: "Cleanup & Compaction Complete",
        message: `Pruned ${res.pruned.metrics} metrics, ${res.pruned.site_configs} configs, and compacted ${res.compacted.length} collections.`,
      });
      fetchMasterData(true);
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Cleanup Failed",
        message: err instanceof Error ? err.message : "Failed to execute cleanup",
      });
    } finally {
      setCleaning(false);
    }
  }

  const filteredCollections = useMemo(() => {
    if (!status?.collections) return [];
    const q = collectionSearch.trim().toLowerCase();
    if (!q) return status.collections;
    return status.collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [status?.collections, collectionSearch]);

  if (loading && !status) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm text-slate-400">Loading master server telemetry...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 shadow-sm">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
                Master Server
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Hub Active
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Central telemetry, host resources, backend process health, and MongoDB 7-day retention storage.
              </p>
            </div>
          </div>
        </div>

        {/* Controls: Auto-refresh & Maintenance */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1 text-xs">
            <span className="px-2 text-slate-400 font-medium flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Refresh:
            </span>
            {[
              { label: "5s", value: 5 },
              { label: "10s", value: 10 },
              { label: "30s", value: 30 },
              { label: "Off", value: 0 },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAutoRefreshInterval(opt.value)}
                className={`rounded px-2 py-1 font-semibold transition-all ${
                  autoRefreshInterval === opt.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchMasterData(false)}
            disabled={refreshing}
            className="border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin text-indigo-400" : ""}`} />
            Refresh
          </Button>

          <span className="hidden xl:inline-block text-[11px] font-mono text-slate-500">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>

          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setCleanupResult(null);
                setCleanupModalOpen(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-500/20"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Reclaim Disk Space
            </Button>
          )}
        </div>
      </div>

      {/* Host Meta Banner */}
      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 flex flex-col justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Master Hostname</span>
            <span className="text-sm font-semibold text-slate-200 truncate mt-1">{status.hostname}</span>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 flex flex-col justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Platform & OS</span>
            <span className="text-sm font-semibold text-slate-200 truncate mt-1">
              {status.platform_name} {status.platform_release}
            </span>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 flex flex-col justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Host Uptime</span>
            <span className="text-sm font-semibold text-indigo-300 font-mono mt-1">
              {formatDuration(status.uptime_seconds)}
            </span>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 flex flex-col justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">MongoDB Latency</span>
            <span className="text-sm font-semibold text-emerald-400 font-mono mt-1 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {status.mongodb_ping_ms} ms
            </span>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 flex flex-col justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Backend Process PID</span>
            <span className="text-sm font-semibold text-sky-400 font-mono mt-1">
              PID {status.process_pid} <span className="text-xs text-slate-400 font-sans">({status.process_threads} threads)</span>
            </span>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 flex flex-col justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Data Retention</span>
            <span className="text-sm font-semibold text-amber-300 font-mono mt-1">
              {status.retention_days} Days <span className="text-xs text-slate-400 font-sans">(7d TTL)</span>
            </span>
          </div>
        </div>
      )}

      {/* Primary Resource Gauges */}
      {status && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* CPU Card */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-sky-400" />
                  Host CPU Load
                </CardTitle>
                <span className="text-xs font-mono text-slate-400">
                  {status.cpu_count_logical} Cores
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold font-mono text-slate-100">
                  {status.cpu_percent.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Load: {status.load_average.join(", ")}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all duration-500 ${
                    status.cpu_percent > 85
                      ? "bg-red-500"
                      : status.cpu_percent > 70
                      ? "bg-amber-500"
                      : "bg-sky-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, status.cpu_percent))}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>Architecture: {status.architecture}</span>
                <span className="truncate max-w-[150px]">{status.processor}</span>
              </div>
            </CardContent>
          </Card>

          {/* Memory Card */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-indigo-400" />
                  Memory (RAM)
                </CardTitle>
                <span className="text-xs font-mono text-slate-400">
                  {formatBytes(status.memory_total)}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold font-mono text-slate-100">
                  {status.memory_percent.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {formatBytes(status.memory_used)} / {formatBytes(status.memory_total)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all duration-500 ${
                    status.memory_percent > 85
                      ? "bg-red-500"
                      : status.memory_percent > 70
                      ? "bg-amber-500"
                      : "bg-indigo-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, status.memory_percent))}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>Free: {formatBytes(status.memory_available)}</span>
                <span>Swap: {status.swap_percent.toFixed(0)}% ({formatBytes(status.swap_used)})</span>
              </div>
            </CardContent>
          </Card>

          {/* Root Disk Space */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-emerald-400" />
                  Root Disk
                </CardTitle>
                <span className="text-xs font-mono text-slate-400">
                  {formatBytes(status.disk_total)}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold font-mono text-slate-100">
                  {status.disk_percent.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {formatBytes(status.disk_used)} Used
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all duration-500 ${
                    status.disk_percent > 90
                      ? "bg-red-500"
                      : status.disk_percent > 75
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, status.disk_percent))}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>Available: {formatBytes(status.disk_free)}</span>
                <span>{status.partitions.length} Partitions</span>
              </div>
            </CardContent>
          </Card>

          {/* MongoDB Allocated Storage */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Database className="h-4 w-4 text-amber-400" />
                  MongoDB Storage
                </CardTitle>
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  v{status.mongodb_version || "7.x"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold font-mono text-slate-100">
                  {formatBytes(status.storage_size_bytes)}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Data: {formatBytes(status.data_size_bytes)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-amber-500 transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        5,
                        status.disk_total > 0
                          ? (status.storage_size_bytes / status.disk_total) * 100
                          : 10
                      )
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>Indexes: {formatBytes(status.index_size_bytes)}</span>
                <span>{status.objects_count.toLocaleString()} Docs</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Rolling Trend Sparklines / Charts */}
      {history.length > 1 && (
        <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                Live 10-Minute Trend Telemetry
              </CardTitle>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="flex items-center gap-1 text-sky-400">
                  <span className="h-2 w-2 rounded-full bg-sky-400" /> CPU Load
                </span>
                <span className="flex items-center gap-1 text-indigo-400">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" /> RAM %
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Disk %
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-28 w-full flex items-end gap-1.5 pt-4 pb-1 border-b border-slate-800">
              {history.map((pt, idx) => (
                <div key={idx} className="flex-1 flex flex-col justify-end h-full gap-0.5 group relative">
                  <div
                    className="w-full bg-sky-500/80 rounded-t-sm transition-all hover:bg-sky-400"
                    style={{ height: `${Math.min(100, Math.max(4, pt.cpu_percent))}%` }}
                  />
                  <div
                    className="w-full bg-indigo-500/80 rounded-t-sm transition-all hover:bg-indigo-400"
                    style={{ height: `${Math.min(100, Math.max(4, pt.memory_percent))}%` }}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col rounded bg-slate-950 px-2 py-1 text-[10px] text-slate-200 border border-slate-800 z-10 whitespace-nowrap shadow-xl">
                    <span className="font-mono text-slate-400">{new Date(pt.timestamp).toLocaleTimeString()}</span>
                    <span className="text-sky-300">CPU: {pt.cpu_percent.toFixed(1)}%</span>
                    <span className="text-indigo-300">RAM: {pt.memory_percent.toFixed(1)}% ({pt.memory_used_mb}MB)</span>
                    <span className="text-emerald-300">Disk: {pt.disk_percent.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-500 pt-1">
              <span>10 minutes ago</span>
              <span>Now ({history.length} samples)</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Core Breakdown & Backend Process Telemetry */}
      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Per-Core Breakdown */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 text-sky-400" />
                Per-Core CPU Load ({status.cpu_per_core.length} Cores)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                {status.cpu_per_core.map((corePct, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-xs"
                  >
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="text-slate-400">Core #{idx}</span>
                      <span className={`font-semibold ${corePct > 80 ? "text-red-400" : "text-sky-300"}`}>
                        {corePct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${corePct > 80 ? "bg-red-500" : "bg-sky-400"}`}
                        style={{ width: `${Math.min(100, Math.max(0, corePct))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Central Process & Realtime Telemetry */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                FastAPI Backend Process
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Process Memory (RSS)</span>
                <span className="font-mono font-semibold text-slate-200">{formatBytes(status.process_memory_rss)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Backend Process Uptime</span>
                <span className="font-mono font-semibold text-indigo-300">{formatDuration(status.process_uptime_seconds)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Active Threads</span>
                <span className="font-mono font-semibold text-sky-400">{status.process_threads} threads</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Socket.IO Connected Clients</span>
                <span className="font-mono font-semibold text-emerald-400">{status.socketio_clients_count} live</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Python Runtime</span>
                <span className="font-mono font-semibold text-slate-300">v{status.python_version}</span>
              </div>
            </CardContent>
          </Card>

          {/* Managed Fleet Pulse */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-indigo-400" />
                Managed Fleet Pulse
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">Online</span>
                  <span className="text-xl font-bold font-mono text-emerald-400">{status.fleet_online_servers}</span>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">Warning</span>
                  <span className="text-xl font-bold font-mono text-amber-400">{status.fleet_warning_servers}</span>
                </div>
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">Offline</span>
                  <span className="text-xl font-bold font-mono text-red-400">{status.fleet_offline_servers}</span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Total Client Sites</span>
                <span className="font-mono font-semibold text-slate-200">{status.fleet_total_sites} sites</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Active Alert Incidents</span>
                <span className="font-mono font-semibold text-amber-400">{status.active_alerts_count}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <span className="text-slate-400">Central Agent Release</span>
                <span className="font-mono font-semibold text-sky-400">
                  v{status.agent_release_version} ({formatBytes(status.agent_release_size_bytes)})
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* MongoDB Collections & 7-Day Retention Breakdown Table */}
      {status && (
        <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Database className="h-4 w-4 text-amber-400" />
                  MongoDB Collections & Storage Retention ({status.collections.length} Collections)
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  Collection sizes, document counts, and automatic 7-day TTL expiration policies.
                </p>
              </div>
              <input
                type="text"
                placeholder="Filter collections..."
                value={collectionSearch}
                onChange={(e) => setCollectionSearch(e.target.value)}
                className="h-8 w-full sm:w-56 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 font-mono uppercase text-[10px] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5">Collection</th>
                    <th className="px-4 py-2.5">Documents</th>
                    <th className="px-4 py-2.5">Data Size</th>
                    <th className="px-4 py-2.5">Allocated Storage</th>
                    <th className="px-4 py-2.5">Indexes</th>
                    <th className="px-4 py-2.5">Retention / TTL Policy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredCollections.map((col) => (
                    <tr key={col.name} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono font-medium text-slate-200 flex items-center gap-2">
                        <Database className="h-3.5 w-3.5 text-slate-500" />
                        {col.name}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">
                        {col.document_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-400">
                        {formatBytes(col.size_bytes)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-400">
                        {formatBytes(col.storage_size_bytes)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-400">
                        {col.indexes_count}
                      </td>
                      <td className="px-4 py-2.5">
                        {col.ttl_info ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20 font-mono">
                            <Clock className="h-3 w-3" />
                            {col.ttl_info}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic font-mono">Persistent</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredCollections.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500 italic">
                        No collections matching "{collectionSearch}"
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network Interfaces & Disk Partitions */}
      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Partitions */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <HardDrive className="h-4 w-4 text-emerald-400" />
                Storage Partitions & Mountpoints
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {status.partitions.map((part) => (
                  <div
                    key={part.mountpoint}
                    className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-semibold text-slate-200">{part.mountpoint}</span>
                      <span className="text-slate-400 text-[11px]">{part.fstype}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400 text-[11px] font-mono">
                      <span>{formatBytes(part.used_bytes)} / {formatBytes(part.total_bytes)}</span>
                      <span>{part.percent.toFixed(1)}% Used</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${part.percent > 85 ? "bg-red-500" : "bg-emerald-400"}`}
                        style={{ width: `${Math.min(100, Math.max(0, part.percent))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Network Interfaces */}
          <Card className="border-slate-800/80 bg-slate-900/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Network className="h-4 w-4 text-sky-400" />
                  Network Interfaces & Traffic
                </CardTitle>
                <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <ArrowDown className="h-3 w-3" />
                    {formatBytes(status.network_bytes_received)}
                  </span>
                  <span className="flex items-center gap-1 text-sky-400">
                    <ArrowUp className="h-3 w-3" />
                    {formatBytes(status.network_bytes_sent)}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(status.network_interfaces).map(([iface, ips]) => (
                  <div
                    key={iface}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-xs font-mono"
                  >
                    <span className="font-semibold text-slate-300 flex items-center gap-2">
                      <Wifi className="h-3.5 w-3.5 text-slate-500" />
                      {iface}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {ips.map((ip) => (
                        <span key={ip} className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                          {ip}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Retention Cleanup Modal */}
      {cleanupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2 text-slate-100 font-semibold">
                <Trash2 className="h-5 w-5 text-indigo-400" />
                <span>Reclaim Disk Space & Run Compaction</span>
              </div>
              <button
                onClick={() => setCleanupModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4 text-xs text-slate-300 space-y-3">
              <p>
                This operation will enforce the <strong>{status?.retention_days ?? 7}-day retention policy</strong> across the central MongoDB database by:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
                <li>Pruning metric history samples older than {status?.retention_days ?? 7} days.</li>
                <li>Deleting config snapshots older than {status?.retention_days ?? 7} days.</li>
                <li>Clearing resolved alerts and terminal log records older than {status?.retention_days ?? 7} days.</li>
                <li>Executing MongoDB collection compaction (<code>compact</code>) to free allocated filesystem space back to disk.</li>
              </ul>

              {cleanupResult && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-1.5 font-mono text-emerald-300 mt-4">
                  <div className="flex items-center gap-1.5 font-bold text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Disk Space Reclamation Finished
                  </div>
                  <div className="text-xs text-slate-300">
                    <div>Pruned Metrics: {cleanupResult.pruned.metrics.toLocaleString()}</div>
                    <div>Pruned Configs: {cleanupResult.pruned.site_configs.toLocaleString()}</div>
                    <div>Pruned Logs: {cleanupResult.pruned.agent_logs.toLocaleString()}</div>
                    <div>Compacted Collections: {cleanupResult.compacted.join(", ")}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCleanupModalOpen(false)}
                className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Close
              </Button>
              <Button
                size="sm"
                onClick={runRetentionCleanup}
                disabled={cleaning}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-500/20"
              >
                {cleaning ? (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Compacting & Pruning...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Run Cleanup & Compaction Now
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
