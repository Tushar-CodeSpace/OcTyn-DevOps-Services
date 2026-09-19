import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Download,
  HardDrive,
  Layers,
  MapPin,
  MemoryStick,
  Network,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { LatestMetric, Metric, Server, Site } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ServerWithLatest extends Server {
  latest: LatestMetric | null;
}

const RANGES = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

const PALETTE = [
  "#38bdf8", // Sky blue
  "#a78bfa", // Purple
  "#34d399", // Emerald
  "#fbbf24", // Amber
  "#f472b6", // Pink
  "#fb7185", // Rose
];

type MetricTab = "all" | "compute" | "storage" | "network" | "api";

function CustomComparisonTooltip({ active, payload, label, unit = "%" }: any) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md text-xs z-50">
      <div className="mb-2 font-mono font-semibold text-slate-300 border-b border-slate-800 pb-1.5 flex items-center justify-between gap-6">
        <span>Time: {label}</span>
        <span className="text-[10px] text-slate-400 font-sans font-normal bg-slate-800/80 px-2 py-0.5 rounded-full">
          {payload.length} {payload.length === 1 ? "Server" : "Servers"}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 min-w-[200px]">
        {payload.map((item: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 truncate max-w-[190px]">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: item.stroke || item.color }}
              />
              <span className="font-semibold text-slate-200 truncate">{item.name}</span>
            </div>
            <span className="font-mono font-bold text-sky-300 shrink-0">
              {item.value !== null && item.value !== undefined ? `${item.value} ${unit}` : "N/A"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Analytics() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<ServerWithLatest[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [serverMetricsMap, setServerMetricsMap] = useState<Record<string, Metric[]>>({});
  const [range, setRange] = useState<number>(60);
  const [activeTab, setActiveTab] = useState<MetricTab>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServerModal, setShowServerModal] = useState(false);
  const [modalClientFilter, setModalClientFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>("");

  const siteMap = useMemo(() => {
    return Object.fromEntries(sites.map((s) => [s.id, s]));
  }, [sites]);

  async function loadOverview(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await apiFetch<{
        sites: Site[];
        servers: ServerWithLatest[];
      }>("/dashboard");
      setSites(data.sites);
      setServers(data.servers);

      // Default select up to 3 servers if none selected
      if (selectedServerIds.length === 0 && data.servers.length > 0) {
        setSelectedServerIds(data.servers.slice(0, 3).map((s) => s.id));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load site analytics");
    } finally {
      setLoading(false);
      if (showRefresh) setRefreshing(false);
    }
  }

  async function loadComparisonMetrics(ids: string[], minutes: number) {
    if (ids.length === 0) {
      setServerMetricsMap({});
      return;
    }
    setLoadingMetrics(true);
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          const m = await apiFetch<Metric[]>(`/metrics/servers/${id}?minutes=${minutes}`);
          return { id, metrics: m };
        })
      );
      const newMap: Record<string, Metric[]> = {};
      for (const res of results) {
        newMap[res.id] = res.metrics;
      }
      setServerMetricsMap(newMap);
    } catch (err) {
      console.error("Metrics load error", err);
    } finally {
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    loadOverview();
    const socket = getSocket();
    const onMetric = () => {
      loadOverview();
    };
    socket.on("metric", onMetric);
    return () => {
      socket.off("metric", onMetric);
    };
  }, []);

  useEffect(() => {
    loadComparisonMetrics(selectedServerIds, range);
  }, [selectedServerIds, range]);

  const toggleServerSelection = (id: string) => {
    setSelectedServerIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 5) return prev; // max 5 for comparison clarity
      return [...prev, id];
    });
  };

  const addServerToSelection = (id: string) => {
    setSelectedServerIds((prev) => {
      if (prev.includes(id)) return prev;
      if (prev.length >= 5) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  interface FleetStats {
    healthScore: number;
    avgCpu: number;
    peakCpuServer: ServerWithLatest | null;
    avgMemory: number;
    peakMemServer: ServerWithLatest | null;
    avgDisk: number;
    peakDiskServer: ServerWithLatest | null;
    totalNetRateKb: number;
    onlineCount: number;
    warningCount: number;
    offlineCount: number;
    totalServers: number;
  }

  // Fleet Health Score & Aggregated KPI calculations
  const fleetStats: FleetStats = useMemo(() => {
    const reportingServers = servers.filter((s) => s.latest !== null);
    const totalServers = servers.length;
    const onlineCount = servers.filter((s) => s.status === "online").length;
    const warningCount = servers.filter((s) => s.status === "warning").length;
    const offlineCount = servers.filter((s) => s.status === "offline").length;

    if (reportingServers.length === 0) {
      return {
        healthScore: totalServers === 0 ? 100 : Math.round((onlineCount / (totalServers || 1)) * 100),
        avgCpu: 0,
        peakCpuServer: null,
        avgMemory: 0,
        peakMemServer: null,
        avgDisk: 0,
        peakDiskServer: null,
        totalNetRateKb: 0,
        onlineCount,
        warningCount,
        offlineCount,
        totalServers,
      };
    }

    let sumCpu = 0;
    let sumMem = 0;
    let sumDisk = 0;
    let sumNetSent = 0;
    let sumNetRecv = 0;

    let peakCpu = -1;
    let peakCpuServer: ServerWithLatest | null = null;
    let peakMem = -1;
    let peakMemServer: ServerWithLatest | null = null;
    let peakDisk = -1;
    let peakDiskServer: ServerWithLatest | null = null;

    reportingServers.forEach((s) => {
      const cpu = s.latest?.cpu_percent ?? 0;
      const mem = s.latest?.memory_percent ?? 0;
      const dsk = s.latest?.disk_percent ?? 0;
      sumCpu += cpu;
      sumMem += mem;
      sumDisk += dsk;
      sumNetSent += s.latest?.network_bytes_sent ?? 0;
      sumNetRecv += s.latest?.network_bytes_received ?? 0;

      if (cpu > peakCpu) {
        peakCpu = cpu;
        peakCpuServer = s;
      }
      if (mem > peakMem) {
        peakMem = mem;
        peakMemServer = s;
      }
      if (dsk > peakDisk) {
        peakDisk = dsk;
        peakDiskServer = s;
      }
    });

    const avgCpu = sumCpu / reportingServers.length;
    const avgMem = sumMem / reportingServers.length;
    const avgDisk = sumDisk / reportingServers.length;

    // Health Score calculation (0 - 100)
    let score = 100;
    if (totalServers > 0) {
      score -= (offlineCount / totalServers) * 40;
      score -= (warningCount / totalServers) * 15;
    }
    if (avgCpu > 80) score -= 15;
    else if (avgCpu > 60) score -= 5;

    if (avgMem > 85) score -= 15;
    else if (avgMem > 75) score -= 5;

    if (avgDisk > 90) score -= 15;
    else if (avgDisk > 80) score -= 5;

    const healthScore = Math.max(0, Math.min(100, Math.round(score)));

    return {
      healthScore,
      avgCpu: Number(avgCpu.toFixed(1)),
      peakCpuServer,
      avgMemory: Number(avgMem.toFixed(1)),
      peakMemServer,
      avgDisk: Number(avgDisk.toFixed(1)),
      peakDiskServer,
      totalNetRateKb: Math.round((sumNetSent + sumNetRecv) / 1024),
      onlineCount,
      warningCount,
      offlineCount,
      totalServers,
    };
  }, [servers]);

  // Bottleneck & Anomaly Detection
  const anomalies = useMemo(() => {
    const alerts: {
      server: ServerWithLatest;
      type: "cpu" | "memory" | "disk" | "error" | "offline";
      label: string;
      value: string;
      severity: "critical" | "warning";
    }[] = [];

    servers.forEach((s) => {
      if (s.status === "offline") {
        alerts.push({
          server: s,
          type: "offline",
          label: "Server Offline",
          value: "Unreachable",
          severity: "critical",
        });
        return;
      }
      const cpu = s.latest?.cpu_percent ?? 0;
      const mem = s.latest?.memory_percent ?? 0;
      const disk = s.latest?.disk_percent ?? 0;
      const errRate = s.latest?.api_error_rate_percent ?? 0;

      if (cpu >= 85) {
        alerts.push({
          server: s,
          type: "cpu",
          label: "High CPU Load",
          value: `${cpu.toFixed(1)}%`,
          severity: cpu >= 95 ? "critical" : "warning",
        });
      }
      if (mem >= 85) {
        alerts.push({
          server: s,
          type: "memory",
          label: "Memory Pressure",
          value: `${mem.toFixed(1)}%`,
          severity: mem >= 92 ? "critical" : "warning",
        });
      }
      if (disk >= 85) {
        alerts.push({
          server: s,
          type: "disk",
          label: "Disk Space Depletion",
          value: `${disk.toFixed(1)}%`,
          severity: disk >= 92 ? "critical" : "warning",
        });
      }
      if (errRate >= 5) {
        alerts.push({
          server: s,
          type: "error",
          label: "API Error Spike",
          value: `${errRate.toFixed(1)}% errors`,
          severity: errRate >= 15 ? "critical" : "warning",
        });
      }
    });

    return alerts;
  }, [servers]);

  // Client & Site Aggregations
  const siteAggregations = useMemo(() => {
    const map: Record<
      string,
      {
        site: Site;
        servers: ServerWithLatest[];
        avgCpu: number;
        avgMem: number;
        maxDisk: number;
        online: number;
        warning: number;
        offline: number;
      }
    > = {};

    sites.forEach((site) => {
      map[site.id] = {
        site,
        servers: [],
        avgCpu: 0,
        avgMem: 0,
        maxDisk: 0,
        online: 0,
        warning: 0,
        offline: 0,
      };
    });

    servers.forEach((srv) => {
      const entry = map[srv.site_id];
      if (entry) {
        entry.servers.push(srv);
        if (srv.status === "online") entry.online++;
        else if (srv.status === "warning") entry.warning++;
        else if (srv.status === "offline") entry.offline++;
      }
    });

    return Object.values(map)
      .map((entry) => {
        const reporting = entry.servers.filter((s) => s.latest !== null);
        if (reporting.length > 0) {
          entry.avgCpu = Number(
            (reporting.reduce((acc, s) => acc + (s.latest?.cpu_percent ?? 0), 0) / reporting.length).toFixed(1)
          );
          entry.avgMem = Number(
            (reporting.reduce((acc, s) => acc + (s.latest?.memory_percent ?? 0), 0) / reporting.length).toFixed(1)
          );
          entry.maxDisk = Number(
            Math.max(...reporting.map((s) => s.latest?.disk_percent ?? 0)).toFixed(1)
          );
        }
        return entry;
      })
      .filter((entry) => entry.servers.length > 0);
  }, [sites, servers]);

  // Distinct clients for modal filtering
  const distinctClients = useMemo(() => {
    const set = new Set<string>();
    sites.forEach((s) => {
      if (s.client) set.add(s.client);
    });
    return Array.from(set);
  }, [sites]);

  // Dynamic slot downsampling based on selected time window
  const slotIntervalMs = useMemo(() => {
    if (range <= 15) return 15 * 1000; // 15 sec
    if (range <= 60) return 30 * 1000; // 30 sec
    if (range <= 360) return 2 * 60 * 1000; // 2 min
    if (range <= 1440) return 10 * 60 * 1000; // 10 min
    return 60 * 60 * 1000; // 1 hr for 7 days
  }, [range]);

  // Build merged aligned timeline for recharts
  const comparisonChartData = useMemo(() => {
    const allTimestamps: number[] = [];
    selectedServerIds.forEach((id) => {
      const list = serverMetricsMap[id] || [];
      list.forEach((m) => {
        const t = new Date(m.recorded_at).getTime();
        if (!isNaN(t)) allTimestamps.push(t);
      });
    });

    if (allTimestamps.length === 0) return [];

    const minTime = Math.min(...allTimestamps);
    const maxTime = Math.max(...allTimestamps);

    const startSlot = Math.floor(minTime / slotIntervalMs) * slotIntervalMs;
    const endSlot = Math.ceil(maxTime / slotIntervalMs) * slotIntervalMs;
    const toleranceMs = Math.max(25 * 1000, slotIntervalMs * 0.75);

    const data: Record<string, unknown>[] = [];

    for (let slot = startSlot; slot <= endSlot; slot += slotIntervalMs) {
      const dateObj = new Date(slot);
      const timeLabel =
        range > 1440
          ? `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const row: Record<string, unknown> = {
        time: timeLabel,
        timestamp: slot,
        fullIso: dateObj.toISOString(),
      };
      let hasData = false;

      selectedServerIds.forEach((id) => {
        const serverList = serverMetricsMap[id] || [];
        let closest: Metric | null = null;
        let minDiff = toleranceMs;

        for (const m of serverList) {
          const mt = new Date(m.recorded_at).getTime();
          const diff = Math.abs(mt - slot);
          if (diff < minDiff) {
            minDiff = diff;
            closest = m;
          }
        }

        if (closest) {
          hasData = true;
          row[`${id}_cpu`] = closest.cpu_percent;
          row[`${id}_memory`] = closest.memory_percent;
          row[`${id}_disk_percent`] = closest.disk_percent;
          row[`${id}_disk_io`] = Number(
            ((closest.disk_read_rate_mb ?? 0) + (closest.disk_write_rate_mb ?? 0)).toFixed(2)
          );
          // Network throughput rate in KB/s (approx or rate if available)
          const netSent = closest.network_bytes_sent ?? 0;
          const netRecv = closest.network_bytes_received ?? 0;
          row[`${id}_net_rate`] = Number(((netSent + netRecv) / 1024).toFixed(1));
          row[`${id}_error_rate`] = closest.api_error_rate_percent ?? 0;
        } else {
          row[`${id}_cpu`] = null;
          row[`${id}_memory`] = null;
          row[`${id}_disk_percent`] = null;
          row[`${id}_disk_io`] = null;
          row[`${id}_net_rate`] = null;
          row[`${id}_error_rate`] = null;
        }
      });

      if (hasData) {
        data.push(row);
      }
    }
    return data;
  }, [selectedServerIds, serverMetricsMap, slotIntervalMs, range]);

  // Export CSV function
  const handleExportCsv = () => {
    if (comparisonChartData.length === 0 || selectedServerIds.length === 0) return;

    const headers = [
      "Timestamp",
      "Time",
      "Server Name",
      "Client",
      "CPU (%)",
      "Memory (%)",
      "Disk Space (%)",
      "Disk IO (MB/s)",
      "Network (KB)",
      "API Error Rate (%)",
    ];

    const rows: string[] = [];
    rows.push(headers.join(","));

    comparisonChartData.forEach((row) => {
      const timeStr = String(row.time || "");
      const fullIso = String(row.fullIso || "");

      selectedServerIds.forEach((id) => {
        const srv = servers.find((s) => s.id === id);
        const site = srv ? siteMap[srv.site_id] : null;
        const srvName = srv ? `"${srv.name.replace(/"/g, '""')}"` : id;
        const clientName = site ? `"${site.client.replace(/"/g, '""')}"` : `"N/A"`;

        const cpu = row[`${id}_cpu`];
        const mem = row[`${id}_memory`];
        const diskP = row[`${id}_disk_percent`];
        const diskIo = row[`${id}_disk_io`];
        const netRate = row[`${id}_net_rate`];
        const errRate = row[`${id}_error_rate`];

        if (cpu !== null && cpu !== undefined) {
          rows.push(
            [
              fullIso,
              timeStr,
              srvName,
              clientName,
              cpu ?? "",
              mem ?? "",
              diskP ?? "",
              diskIo ?? "",
              netRate ?? "",
              errRate ?? "",
            ].join(",")
          );
        }
      });
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `octyn_telemetry_${range}m_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Preset Selection Handlers
  const selectTopCpu = () => {
    const top = [...servers]
      .filter((s) => s.latest !== null)
      .sort((a, b) => (b.latest?.cpu_percent ?? 0) - (a.latest?.cpu_percent ?? 0))
      .slice(0, 3)
      .map((s) => s.id);
    if (top.length > 0) setSelectedServerIds(top);
  };

  const selectTopRam = () => {
    const top = [...servers]
      .filter((s) => s.latest !== null)
      .sort((a, b) => (b.latest?.memory_percent ?? 0) - (a.latest?.memory_percent ?? 0))
      .slice(0, 3)
      .map((s) => s.id);
    if (top.length > 0) setSelectedServerIds(top);
  };

  const selectSiteServers = (siteId: string) => {
    const siteServers = servers.filter((s) => s.site_id === siteId).slice(0, 5).map((s) => s.id);
    if (siteServers.length > 0) setSelectedServerIds(siteServers);
  };

  // Top resource consumers
  const topCpu = useMemo(() => {
    return [...servers]
      .filter((s) => s.latest !== null)
      .sort((a, b) => (b.latest?.cpu_percent ?? 0) - (a.latest?.cpu_percent ?? 0))
      .slice(0, 5);
  }, [servers]);

  const topMem = useMemo(() => {
    return [...servers]
      .filter((s) => s.latest !== null)
      .sort((a, b) => (b.latest?.memory_percent ?? 0) - (a.latest?.memory_percent ?? 0))
      .slice(0, 5);
  }, [servers]);

  const topDisk = useMemo(() => {
    return [...servers]
      .filter((s) => s.latest !== null)
      .sort((a, b) => (b.latest?.disk_percent ?? 0) - (a.latest?.disk_percent ?? 0))
      .slice(0, 5);
  }, [servers]);

  // Modal filtered servers
  const modalFilteredServers = useMemo(() => {
    return servers.filter((s) => {
      const site = siteMap[s.site_id];
      const matchClient =
        modalClientFilter === "all" || (site && site.client === modalClientFilter);
      const matchSearch =
        !searchFilter ||
        s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        s.hostname.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (site && site.client.toLowerCase().includes(searchFilter.toLowerCase()));
      return matchClient && matchSearch;
    });
  }, [servers, modalClientFilter, searchFilter, siteMap]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header with Title, Actions, and Range Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-100">Telemetry Analytics</h1>
              <p className="text-xs text-slate-400">
                Multi-server comparative performance telemetry, bottleneck anomaly detection & capacity trends
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Refresh button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadOverview(true)}
            disabled={refreshing}
            className="border-slate-800 bg-slate-900 text-slate-300 hover:text-white gap-1.5 h-8 text-xs"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin text-sky-400")} />
            <span>Refresh</span>
          </Button>

          {/* Export CSV button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={comparisonChartData.length === 0}
            className="border-slate-800 bg-slate-900 text-slate-300 hover:text-white gap-1.5 h-8 text-xs"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </Button>

          {/* Timeframe Controls */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.minutes}
                onClick={() => setRange(r.minutes)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded-md transition-all",
                  range === r.minutes
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Fleet Health & Aggregate Telemetry KPI Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Health Score */}
        <Card className="border-slate-800 bg-slate-900/90 shadow-md">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Fleet Health Index</span>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span
                className={cn(
                  "text-2xl font-bold font-mono",
                  fleetStats.healthScore >= 90
                    ? "text-emerald-400"
                    : fleetStats.healthScore >= 70
                    ? "text-amber-400"
                    : "text-rose-400"
                )}
              >
                {fleetStats.healthScore}%
              </span>
              <span className="text-[11px] text-slate-400">
                {fleetStats.healthScore >= 90
                  ? "Optimal"
                  : fleetStats.healthScore >= 70
                  ? "Degraded"
                  : "Critical"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="text-emerald-400 font-semibold">{fleetStats.onlineCount} online</span>
              <span>·</span>
              <span className="text-amber-400 font-semibold">{fleetStats.warningCount} warn</span>
              <span>·</span>
              <span className="text-rose-400 font-semibold">{fleetStats.offlineCount} offline</span>
            </div>
          </CardContent>
        </Card>

        {/* Fleet Average CPU */}
        <Card className="border-slate-800 bg-slate-900/90 shadow-md">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Avg Fleet CPU</span>
              <Cpu className="h-4 w-4 text-sky-400" />
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-sky-300">{fleetStats.avgCpu}%</span>
              <span className="text-[11px] text-slate-400">Across {fleetStats.totalServers} nodes</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {fleetStats.peakCpuServer ? (
                <>
                  Peak: <strong className="text-slate-200">{fleetStats.peakCpuServer.latest?.cpu_percent?.toFixed(1)}%</strong> on{" "}
                  <span className="text-sky-300 font-mono">{fleetStats.peakCpuServer.name}</span>
                </>
              ) : (
                "No metric telemetry"
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fleet Average Memory */}
        <Card className="border-slate-800 bg-slate-900/90 shadow-md">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Avg Fleet RAM</span>
              <MemoryStick className="h-4 w-4 text-purple-400" />
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-purple-300">{fleetStats.avgMemory}%</span>
              <span className="text-[11px] text-slate-400">Memory Pressure</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {fleetStats.peakMemServer ? (
                <>
                  Peak: <strong className="text-slate-200">{fleetStats.peakMemServer.latest?.memory_percent?.toFixed(1)}%</strong> on{" "}
                  <span className="text-purple-300 font-mono">{fleetStats.peakMemServer.name}</span>
                </>
              ) : (
                "No metric telemetry"
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fleet Average Storage */}
        <Card className="border-slate-800 bg-slate-900/90 shadow-md">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Avg Disk Space</span>
              <HardDrive className="h-4 w-4 text-amber-400" />
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-amber-300">{fleetStats.avgDisk}%</span>
              <span className="text-[11px] text-slate-400">Storage Usage</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {fleetStats.peakDiskServer ? (
                <>
                  Peak: <strong className="text-slate-200">{fleetStats.peakDiskServer.latest?.disk_percent?.toFixed(1)}%</strong> on{" "}
                  <span className="text-amber-300 font-mono">{fleetStats.peakDiskServer.name}</span>
                </>
              ) : (
                "No metric telemetry"
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fleet Total Network Throughput */}
        <Card className="border-slate-800 bg-slate-900/90 shadow-md">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Live Traffic Volume</span>
              <Network className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-emerald-300">
                {fleetStats.totalNetRateKb > 1024
                  ? `${(fleetStats.totalNetRateKb / 1024).toFixed(1)} MB`
                  : `${fleetStats.totalNetRateKb} KB`}
              </span>
              <span className="text-[11px] text-slate-400">Total Transferred</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
              <Zap className="h-3 w-3 text-emerald-400" />
              <span>Real-time I/O across edge agents</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Anomaly & Bottleneck Detector Bar */}
      {anomalies.length > 0 ? (
        <Card className="border-amber-500/30 bg-amber-950/20 shadow-md">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b border-amber-500/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Resource Bottlenecks & Anomaly Alerts ({anomalies.length} Detected)
              </CardTitle>
            </div>
            <span className="text-[10px] text-amber-400/80 font-mono">Real-time telemetry scan</span>
          </CardHeader>
          <CardContent className="p-3 flex flex-wrap gap-2">
            {anomalies.map((anom, idx) => {
              const isSelected = selectedServerIds.includes(anom.server.id);
              const site = siteMap[anom.server.site_id];
              return (
                <div
                  key={`${anom.server.id}-${idx}`}
                  className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 shadow-sm"
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      anom.severity === "critical" ? "bg-rose-500 animate-pulse" : "bg-amber-400"
                    )}
                  />
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="text-slate-100">{anom.server.name}</span>
                    {site && <span className="text-[10px] text-slate-400">({site.client})</span>}
                    <span className="text-slate-500">·</span>
                    <span className={anom.severity === "critical" ? "text-rose-400 font-semibold" : "text-amber-400 font-semibold"}>
                      {anom.label}: {anom.value}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => addServerToSelection(anom.server.id)}
                      disabled={isSelected}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                        isSelected
                          ? "bg-slate-800 text-slate-500 cursor-default"
                          : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                      )}
                    >
                      {isSelected ? "Comparing" : "+ Compare"}
                    </button>
                    <button
                      onClick={() => navigate(`/servers/${anom.server.id}`)}
                      className="rounded p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                      title="Inspect Server"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>Fleet Health Nominal: All reporting site nodes are currently operating within safe resource thresholds.</span>
        </div>
      )}

      {/* Top Consumers Leaderboards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Top CPU */}
        <Card className="border-sky-500/30 bg-slate-900/90 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Cpu className="h-4 w-4" /> Top CPU Load
            </CardTitle>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Real-time</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : topCpu.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No metrics reporting</p>
            ) : (
              topCpu.map((s, idx) => {
                const cpu = s.latest?.cpu_percent ?? 0;
                const st = siteMap[s.site_id];
                const isSelected = selectedServerIds.includes(s.id);
                return (
                  <div
                    key={s.id}
                    className="group flex flex-col gap-1 p-2 rounded-lg hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div
                        onClick={() => navigate(`/servers/${s.id}`)}
                        className="flex flex-col min-w-0 pr-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-mono text-slate-500 w-3 shrink-0">#{idx + 1}</span>
                          <span className="font-semibold text-slate-200 group-hover:text-sky-300 transition-colors truncate">
                            {s.name}
                          </span>
                        </div>
                        {st && (
                          <div className="flex items-center gap-1.5 pl-4.5 text-[10px] text-slate-400 truncate">
                            <span className="inline-flex items-center gap-0.5 text-sky-300 font-medium truncate">
                              <Building2 className="h-2.5 w-2.5 shrink-0" />
                              {st.client}
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5 text-slate-400 truncate">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {st.location}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => toggleServerSelection(s.id)}
                          className={cn(
                            "opacity-0 group-hover:opacity-100 transition-opacity rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            isSelected
                              ? "bg-slate-800 text-sky-400"
                              : "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
                          )}
                        >
                          {isSelected ? "Selected" : "+ Compare"}
                        </button>
                        <span className="font-mono font-bold text-sky-400">{cpu.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(cpu, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Top Memory */}
        <Card className="border-purple-500/30 bg-slate-900/90 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <MemoryStick className="h-4 w-4" /> Top Memory Usage
            </CardTitle>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Real-time</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : topMem.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No metrics reporting</p>
            ) : (
              topMem.map((s, idx) => {
                const mem = s.latest?.memory_percent ?? 0;
                const st = siteMap[s.site_id];
                const isSelected = selectedServerIds.includes(s.id);
                return (
                  <div
                    key={s.id}
                    className="group flex flex-col gap-1 p-2 rounded-lg hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div
                        onClick={() => navigate(`/servers/${s.id}`)}
                        className="flex flex-col min-w-0 pr-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-mono text-slate-500 w-3 shrink-0">#{idx + 1}</span>
                          <span className="font-semibold text-slate-200 group-hover:text-purple-300 transition-colors truncate">
                            {s.name}
                          </span>
                        </div>
                        {st && (
                          <div className="flex items-center gap-1.5 pl-4.5 text-[10px] text-slate-400 truncate">
                            <span className="inline-flex items-center gap-0.5 text-purple-300 font-medium truncate">
                              <Building2 className="h-2.5 w-2.5 shrink-0" />
                              {st.client}
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5 text-slate-400 truncate">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {st.location}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => toggleServerSelection(s.id)}
                          className={cn(
                            "opacity-0 group-hover:opacity-100 transition-opacity rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            isSelected
                              ? "bg-slate-800 text-purple-400"
                              : "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
                          )}
                        >
                          {isSelected ? "Selected" : "+ Compare"}
                        </button>
                        <span className="font-mono font-bold text-purple-400">{mem.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(mem, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Top Disk */}
        <Card className="border-amber-500/30 bg-slate-900/90 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <HardDrive className="h-4 w-4" /> Top Disk Space
            </CardTitle>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Real-time</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : topDisk.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No metrics reporting</p>
            ) : (
              topDisk.map((s, idx) => {
                const dsk = s.latest?.disk_percent ?? 0;
                const st = siteMap[s.site_id];
                const isSelected = selectedServerIds.includes(s.id);
                return (
                  <div
                    key={s.id}
                    className="group flex flex-col gap-1 p-2 rounded-lg hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div
                        onClick={() => navigate(`/servers/${s.id}`)}
                        className="flex flex-col min-w-0 pr-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-mono text-slate-500 w-3 shrink-0">#{idx + 1}</span>
                          <span className="font-semibold text-slate-200 group-hover:text-amber-300 transition-colors truncate">
                            {s.name}
                          </span>
                        </div>
                        {st && (
                          <div className="flex items-center gap-1.5 pl-4.5 text-[10px] text-slate-400 truncate">
                            <span className="inline-flex items-center gap-0.5 text-amber-300 font-medium truncate">
                              <Building2 className="h-2.5 w-2.5 shrink-0" />
                              {st.client}
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5 text-slate-400 truncate">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {st.location}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => toggleServerSelection(s.id)}
                          className={cn(
                            "opacity-0 group-hover:opacity-100 transition-opacity rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            isSelected
                              ? "bg-slate-800 text-amber-400"
                              : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                          )}
                        >
                          {isSelected ? "Selected" : "+ Compare"}
                        </button>
                        <span className="font-mono font-bold text-amber-400">{dsk.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(dsk, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Client & Site Infrastructure Resource Roll-up */}
      <Card className="border-slate-800 bg-slate-900/90 shadow-md">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-sky-400" />
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Client & Site Resource Aggregation
            </CardTitle>
          </div>
          <span className="text-[11px] text-slate-400">
            {siteAggregations.length} Active Monitored Sites
          </span>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Client & Site Location</th>
                <th className="py-2.5 px-3 text-center">Node Count</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Avg CPU</th>
                <th className="py-2.5 px-3 text-right">Avg Memory</th>
                <th className="py-2.5 px-3 text-right">Max Disk</th>
                <th className="py-2.5 px-4 text-right">Quick Compare</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {siteAggregations.map((entry) => (
                <tr key={entry.site.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 px-4">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-100">{entry.site.client}</span>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />
                        {entry.site.location} ({entry.site.code})
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono">{entry.servers.length}</td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="inline-flex items-center gap-1.5">
                      {entry.offline > 0 ? (
                        <Badge variant="red" className="text-[10px] px-1.5 py-0 h-4.5">
                          {entry.offline} offline
                        </Badge>
                      ) : entry.warning > 0 ? (
                        <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0 h-4.5">
                          {entry.warning} warn
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] px-1.5 py-0 h-4.5">
                          All Healthy
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-sky-300">
                    {entry.avgCpu}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-purple-300">
                    {entry.avgMem}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-amber-300">
                    {entry.maxDisk}%
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectSiteServers(entry.site.id)}
                      className="h-6 px-2 text-[10px] border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200"
                    >
                      Compare Site Nodes
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Multi-Server Comparison Workspace */}
      <Card className="border-slate-800 shadow-xl bg-slate-900/80">
        <CardHeader className="flex flex-col gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Layers className="h-5 w-5 text-emerald-400" />
                Side-by-Side Server Comparison Workspace
              </CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Select 1 to 5 site servers to synchronize and compare telemetry over {range >= 1440 ? `${Math.round(range / 1440)}d` : `${range}m`}
              </p>
            </div>

            {/* Selector & Presets */}
            <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
              {/* Quick Presets */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectTopCpu}
                  className="h-7 px-2 text-[11px] border-sky-500/30 bg-sky-950/30 text-sky-300 hover:bg-sky-900/40"
                >
                  Top 3 CPU
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectTopRam}
                  className="h-7 px-2 text-[11px] border-purple-500/30 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40"
                >
                  Top 3 RAM
                </Button>
                {selectedServerIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedServerIds([])}
                    className="h-7 px-2 text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </Button>
                )}
              </div>

              {/* Server Selector Modal Trigger */}
              <div className="relative shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowServerModal((prev) => !prev)}
                  className="border-sky-500/40 bg-slate-950/90 hover:bg-slate-800 text-sky-300 font-semibold shadow-md gap-2 h-7.5"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
                  <span className="text-xs">Select Servers ({selectedServerIds.length}/5)</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showServerModal && "rotate-180")} />
                </Button>

                {/* Dropdown Menu / Selection Modal */}
                {showServerModal && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowServerModal(false)}
                    />

                    <div className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-xl border border-slate-700 bg-slate-900/98 p-3.5 shadow-2xl backdrop-blur-xl">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                            Select Site Servers (Max 5)
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            Select nodes to plot synchronized telemetry
                          </p>
                        </div>
                        <button
                          onClick={() => setShowServerModal(false)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Filters inside modal */}
                      <div className="flex flex-col gap-2 mb-2.5">
                        <input
                          type="text"
                          placeholder="Search servers or clients..."
                          value={searchFilter}
                          onChange={(e) => setSearchFilter(e.target.value)}
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                        />
                        {distinctClients.length > 1 && (
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => setModalClientFilter("all")}
                              className={cn(
                                "px-2 py-0.5 text-[10px] rounded-full transition-colors",
                                modalClientFilter === "all"
                                  ? "bg-sky-600 text-white font-semibold"
                                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
                              )}
                            >
                              All Clients
                            </button>
                            {distinctClients.map((cl) => (
                              <button
                                key={cl}
                                onClick={() => setModalClientFilter(cl)}
                                className={cn(
                                  "px-2 py-0.5 text-[10px] rounded-full transition-colors",
                                  modalClientFilter === cl
                                    ? "bg-sky-600 text-white font-semibold"
                                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                )}
                              >
                                {cl}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="max-h-60 overflow-y-auto flex flex-col gap-1 pr-1">
                        {modalFilteredServers.length === 0 ? (
                          <p className="text-xs text-slate-500 py-3 text-center">No servers match filter</p>
                        ) : (
                          modalFilteredServers.map((s) => {
                            const selected = selectedServerIds.includes(s.id);
                            const color = selected
                              ? PALETTE[selectedServerIds.indexOf(s.id) % PALETTE.length]
                              : undefined;
                            const site = siteMap[s.site_id];

                            return (
                              <div
                                key={s.id}
                                onClick={() => toggleServerSelection(s.id)}
                                className={cn(
                                  "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border",
                                  selected
                                    ? "bg-slate-800/90 border-slate-600 text-slate-100 shadow-sm"
                                    : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                                )}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                  <div
                                    className={cn(
                                      "flex h-4 w-4 items-center justify-center rounded border transition-colors shrink-0",
                                      selected
                                        ? "border-sky-500 bg-sky-600 text-white"
                                        : "border-slate-600 bg-slate-950 text-transparent"
                                    )}
                                  >
                                    <Check className="h-3 w-3" />
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-semibold text-xs text-slate-200 truncate">{s.name}</span>
                                    {site && (
                                      <span className="text-[10px] text-slate-400 truncate">
                                        {site.client} · {site.location}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {selected && (
                                  <span
                                    className="h-3 w-3 rounded-full shrink-0 shadow-sm"
                                    style={{ backgroundColor: color }}
                                  />
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          Selected: <strong className="text-sky-300">{selectedServerIds.length}</strong> / 5
                        </span>
                        <Button
                          size="sm"
                          onClick={() => setShowServerModal(false)}
                          className="bg-sky-600 hover:bg-sky-500 text-white h-7 px-3 text-xs"
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Active Selected Server Badges & Metric Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2 border-t border-slate-800/60">
            {/* Active Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedServerIds.length === 0 ? (
                <span className="text-xs text-slate-500 italic">No servers currently selected for comparison</span>
              ) : (
                selectedServerIds.map((id) => {
                  const srv = servers.find((s) => s.id === id);
                  const color = PALETTE[selectedServerIds.indexOf(id) % PALETTE.length];
                  if (!srv) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-xs font-medium text-slate-200 shadow-sm"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      <span>{srv.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleServerSelection(id);
                        }}
                        className="text-slate-400 hover:text-slate-100 transition-colors ml-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            {/* Metric Category Tabs */}
            <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 self-start sm:self-auto">
              <button
                onClick={() => setActiveTab("all")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                  activeTab === "all"
                    ? "bg-slate-800 text-slate-100 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                All Metrics
              </button>
              <button
                onClick={() => setActiveTab("compute")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                  activeTab === "compute"
                    ? "bg-slate-800 text-sky-400 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Compute
              </button>
              <button
                onClick={() => setActiveTab("storage")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                  activeTab === "storage"
                    ? "bg-slate-800 text-amber-400 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Storage
              </button>
              <button
                onClick={() => setActiveTab("network")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                  activeTab === "network"
                    ? "bg-slate-800 text-emerald-400 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Network
              </button>
              <button
                onClick={() => setActiveTab("api")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                  activeTab === "api"
                    ? "bg-slate-800 text-rose-400 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                API & Health
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6 flex flex-col gap-8">
          {selectedServerIds.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">
              Select at least one server above to generate comparison telemetry charts.
            </div>
          ) : loadingMetrics ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Skeleton className="h-[280px] w-full" />
            </div>
          ) : (
            <>
              {/* CPU Comparison Chart */}
              {(activeTab === "all" || activeTab === "compute") && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                      <Cpu className="h-4 w-4" /> Comparative CPU Load (%)
                    </h3>
                    <span className="text-xs text-slate-500">{range >= 1440 ? `${Math.round(range / 1440)} days` : `${range} minutes`} window</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        domain={[0, (dataMax: number) => Math.min(100, Math.max(10, Math.ceil(dataMax * 1.15)))]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip content={<CustomComparisonTooltip unit="%" />} />
                      <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                      {selectedServerIds.map((id, idx) => {
                        const srv = servers.find((s) => s.id === id);
                        const key = `${id}_cpu`;
                        const color = PALETTE[idx % PALETTE.length];
                        return (
                          <Line
                            key={id}
                            type="monotone"
                            connectNulls={true}
                            dataKey={key}
                            name={srv ? `${srv.name} (${siteMap[srv.site_id]?.client || "Site"})` : id.slice(0, 6)}
                            stroke={color}
                            strokeWidth={2.5}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* RAM Comparison Chart */}
              {(activeTab === "all" || activeTab === "compute") && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                      <MemoryStick className="h-4 w-4" /> Comparative Memory Utilization (%)
                    </h3>
                    <span className="text-xs text-slate-500">{range >= 1440 ? `${Math.round(range / 1440)} days` : `${range} minutes`} window</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        domain={[
                          (dataMin: number) => Math.max(0, Math.floor(dataMin - 2)),
                          (dataMax: number) => Math.min(100, Math.ceil(dataMax + 2)),
                        ]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip content={<CustomComparisonTooltip unit="%" />} />
                      <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                      {selectedServerIds.map((id, idx) => {
                        const srv = servers.find((s) => s.id === id);
                        const key = `${id}_memory`;
                        const color = PALETTE[idx % PALETTE.length];
                        return (
                          <Line
                            key={id}
                            type="monotone"
                            connectNulls={true}
                            dataKey={key}
                            name={srv ? `${srv.name} (${siteMap[srv.site_id]?.client || "Site"})` : id.slice(0, 6)}
                            stroke={color}
                            strokeWidth={2.5}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Disk I/O Throughput Comparison */}
              {(activeTab === "all" || activeTab === "storage") && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4" /> Comparative Disk I/O Throughput (MB/s)
                    </h3>
                    <span className="text-xs text-slate-500">Total Read + Write Rate</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        domain={[0, (dataMax: number) => Math.max(1, Number((dataMax * 1.15).toFixed(1)))]}
                        tickFormatter={(v) => `${v} MB/s`}
                      />
                      <Tooltip content={<CustomComparisonTooltip unit="MB/s" />} />
                      <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                      {selectedServerIds.map((id, idx) => {
                        const srv = servers.find((s) => s.id === id);
                        const key = `${id}_disk_io`;
                        const color = PALETTE[idx % PALETTE.length];
                        return (
                          <Line
                            key={id}
                            type="monotone"
                            connectNulls={true}
                            dataKey={key}
                            name={srv ? `${srv.name}` : id.slice(0, 6)}
                            stroke={color}
                            strokeWidth={2.5}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Network Throughput Comparison */}
              {(activeTab === "all" || activeTab === "network") && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <Network className="h-4 w-4" /> Comparative Network Traffic Volume (KB)
                    </h3>
                    <span className="text-xs text-slate-500">Aggregated Ingress + Egress</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        domain={[0, (dataMax: number) => Math.max(10, Number((dataMax * 1.15).toFixed(0)))]}
                        tickFormatter={(v) => `${v} KB`}
                      />
                      <Tooltip content={<CustomComparisonTooltip unit="KB" />} />
                      <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                      {selectedServerIds.map((id, idx) => {
                        const srv = servers.find((s) => s.id === id);
                        const key = `${id}_net_rate`;
                        const color = PALETTE[idx % PALETTE.length];
                        return (
                          <Line
                            key={id}
                            type="monotone"
                            connectNulls={true}
                            dataKey={key}
                            name={srv ? `${srv.name}` : id.slice(0, 6)}
                            stroke={color}
                            strokeWidth={2.5}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* API Error Rate Comparison */}
              {(activeTab === "all" || activeTab === "api") && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                      <Activity className="h-4 w-4" /> Comparative API Error Rate (%)
                    </h3>
                    <span className="text-xs text-slate-500">HTTP 4xx / 5xx Failure Percentage</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        domain={[0, (dataMax: number) => Math.min(100, Math.max(5, Math.ceil(dataMax * 1.25)))]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip content={<CustomComparisonTooltip unit="%" />} />
                      <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                      {selectedServerIds.map((id, idx) => {
                        const srv = servers.find((s) => s.id === id);
                        const key = `${id}_error_rate`;
                        const color = PALETTE[idx % PALETTE.length];
                        return (
                          <Line
                            key={id}
                            type="monotone"
                            connectNulls={true}
                            dataKey={key}
                            name={srv ? `${srv.name}` : id.slice(0, 6)}
                            stroke={color}
                            strokeWidth={2.5}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
