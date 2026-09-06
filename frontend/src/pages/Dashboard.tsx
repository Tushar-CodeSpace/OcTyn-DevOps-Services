import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Copy,
  Grid,
  List,
  MapPin,
  Plus,
  Rocket,
  Search,
  Server as ServerIcon,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/socket";
import type { LatestMetric, Server, Site } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatTime, formatUptime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardServer extends Server {
  latest: LatestMetric | null;
}

interface Totals {
  servers: number;
  sites: number;
  online: number;
  warning: number;
  offline: number;
  unknown: number;
  active_alerts: number;
}

interface Registered {
  siteId: string;
  serverId: string;
  name: string;
  key: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [servers, setServers] = useState<DashboardServer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "sites">("table");
  const [sortField, setSortField] = useState<"name" | "status" | "cpu" | "memory" | "disk" | "last_seen">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [showAdd, setShowAdd] = useState(false);
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [form, setForm] = useState({
    client: "",
    location: "",
    name: "",
    monitored_services: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<DashboardServer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const siteName = (siteId: string) => sites.find((s) => s.id === siteId)?.client ?? siteId.slice(0, 8);
  const siteLocation = (siteId: string) => sites.find((s) => s.id === siteId)?.location ?? "—";

  async function load() {
    try {
      const data = await apiFetch<{
        sites: Site[];
        servers: DashboardServer[];
        totals: Totals;
      }>("/dashboard");
      setSites(data.sites);
      setServers(data.servers);
      setTotals(data.totals);
      setLastUpdated(new Date());
      return data.servers;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // fallback; socket keeps it live

    const socket = getSocket();
    const joined = new Set<string>();

    const onStatus = (d: { server_id: string; status: Server["status"] }) => {
      setServers((prev) =>
        prev.map((s) => (s.id === d.server_id ? { ...s, status: d.status } : s))
      );
    };
    const onMetric = (m: LatestMetric & { server_id: string }) => {
      const { server_id, ...rest } = m;
      setServers((prev) =>
        prev.map((s) =>
          s.id === server_id ? { ...s, latest: rest, last_seen_at: rest.recorded_at } : s
        )
      );
    };
    const onAlert = () => load();

    const onServerCreated = (s: Server) => {
      setServers((prev) =>
        prev.some((x) => x.id === s.id) ? prev : [...prev, { ...s, latest: null }]
      );
      if (!joined.has(s.id)) {
        socket.emit("join", s.id);
        joined.add(s.id);
      }
      apiFetch<Site[]>("/sites").then(setSites).catch(() => {});
    };
    const onServerUpdated = (s: Server) => {
      setServers((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...s } : x)));
    };
    const onServerDeleted = (d: { server_id: string }) => {
      setServers((prev) => prev.filter((x) => x.id !== d.server_id));
      if (joined.has(d.server_id)) {
        socket.emit("leave", d.server_id);
        joined.delete(d.server_id);
      }
    };

    socket.on("server_status", onStatus);
    socket.on("metric", onMetric);
    socket.on("alert_opened", onAlert);
    socket.on("alert_resolved", onAlert);
    socket.on("server_created", onServerCreated);
    socket.on("server_updated", onServerUpdated);
    socket.on("server_deleted", onServerDeleted);

    const joinAll = async () => {
      const list = await load().catch(() => [] as DashboardServer[]);
      for (const s of list) {
        if (!joined.has(s.id)) {
          socket.emit("join", s.id);
          joined.add(s.id);
        }
      }
    };
    joinAll();
    const joinTimer = setInterval(joinAll, 60000);

    return () => {
      clearInterval(t);
      clearInterval(joinTimer);
      socket.off("server_status", onStatus);
      socket.off("metric", onMetric);
      socket.off("alert_opened", onAlert);
      socket.off("alert_resolved", onAlert);
      socket.off("server_created", onServerCreated);
      socket.off("server_updated", onServerUpdated);
      socket.off("server_deleted", onServerDeleted);
      for (const id of joined) socket.emit("leave", id);
    };
  }, []);

  const clients = [
    ...new Set(
      sites
        .filter((st) => servers.some((s) => s.site_id === st.id))
        .map((st) => st.client)
    ),
  ].sort();
  const statuses = ["online", "warning", "offline", "unknown"] as const;

  const filtered = servers
    .filter((s) => {
      if (clientFilter !== "all" && siteName(s.site_id) !== clientFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const site = sites.find((st) => st.id === s.site_id);
        const match =
          s.name.toLowerCase().includes(q) ||
          s.hostname.toLowerCase().includes(q) ||
          (s.ip_address && s.ip_address.toLowerCase().includes(q)) ||
          (site && (site.client.toLowerCase().includes(q) || site.location.toLowerCase().includes(q)));
        if (!match) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;
      if (sortField === "name") {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortField === "status") {
        valA = a.status;
        valB = b.status;
      } else if (sortField === "cpu") {
        valA = a.latest?.cpu_percent ?? -1;
        valB = b.latest?.cpu_percent ?? -1;
      } else if (sortField === "memory") {
        valA = a.latest?.memory_percent ?? -1;
        valB = b.latest?.memory_percent ?? -1;
      } else if (sortField === "disk") {
        valA = a.latest?.disk_percent ?? -1;
        valB = b.latest?.disk_percent ?? -1;
      } else if (sortField === "last_seen") {
        valA = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
        valB = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      }

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Group sites by client name and location pair for Site Topology
  const siteGroupMap = new Map<
    string,
    {
      client: string;
      location: string;
      siteIds: string[];
    }
  >();

  sites.forEach((site) => {
    const key = `${site.client.trim().toLowerCase()}|||${site.location.trim().toLowerCase()}`;
    if (!siteGroupMap.has(key)) {
      siteGroupMap.set(key, {
        client: site.client,
        location: site.location,
        siteIds: [site.id],
      });
    } else {
      siteGroupMap.get(key)!.siteIds.push(site.id);
    }
  });

  const sitesGrouped = Array.from(siteGroupMap.entries())
    .map(([key, g]) => {
      const siteServers = filtered.filter((s) => g.siteIds.includes(s.site_id));
      const total = siteServers.length;
      const online = siteServers.filter((s) => s.status === "online").length;
      const warning = siteServers.filter((s) => s.status === "warning").length;
      const offline = siteServers.filter((s) => s.status === "offline").length;
      const avgCpu = total > 0 ? siteServers.reduce((acc, s) => acc + (s.latest?.cpu_percent ?? 0), 0) / total : 0;
      const avgMem = total > 0 ? siteServers.reduce((acc, s) => acc + (s.latest?.memory_percent ?? 0), 0) / total : 0;
      const healthScore = total > 0 ? Math.round((online / total) * 100) : 100;

      return {
        groupKey: key,
        site: { client: g.client, location: g.location },
        servers: siteServers,
        total,
        online,
        warning,
        offline,
        avgCpu,
        avgMem,
        healthScore,
      };
    })
    .filter((g) => g.total > 0 || (!clientFilter && !statusFilter && !searchQuery));

  const selectCls =
    "rounded-lg border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-300 outline-none transition-colors focus:border-sky-500/60 [&>option]:bg-slate-900";

  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "site";

  async function createSite(client: string, location: string): Promise<Site> {
    const base = slug(client);
    for (let i = 0; i < 10; i++) {
      const code = i === 0 ? base : `${base}_${i + 1}`;
      try {
        return await apiFetch<Site>("/sites", {
          method: "POST",
          body: JSON.stringify({ client, code, location }),
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("409")) continue;
        throw err;
      }
    }
    throw new Error("Could not create site (code collisions)");
  }

  async function addAgent() {
    setAdding(true);
    setAddError(null);
    try {
      const site = await createSite(form.client.trim(), form.location.trim());
      const server = await apiFetch<{ id: string; name: string }>("/servers", {
        method: "POST",
        body: JSON.stringify({
          site_id: site.id,
          name: form.name.trim(),
          hostname: form.name.trim(),
          ip_address: null,
        }),
      });
      const keyRes = await apiFetch<{ raw_key: string }>(`/servers/${server.id}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ name: "agent" }),
      });
      setRegistered({
        siteId: site.id,
        serverId: server.id,
        name: server.name,
        key: keyRes.raw_key,
      });
      setForm({ client: "", location: "", name: "", monitored_services: "" });
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setAdding(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/servers/${deleteTarget.id}`, { method: "DELETE" });
      setServers((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
  }

  const liveTotals = totals
    ? {
        ...totals,
        servers: servers.length,
        online: servers.filter((s) => s.status === "online").length,
        warning: servers.filter((s) => s.status === "warning").length,
        offline: servers.filter((s) => s.status === "offline").length,
        unknown: servers.filter((s) => s.status === "unknown").length,
      }
    : null;

  const CARD_FILTERS: Partial<Record<string, Server["status"] | "all">> = {
    Servers: "all",
    Online: "online",
    Warning: "warning",
    Offline: "offline",
  };

  const cards = [
    { label: "Servers", value: liveTotals?.servers ?? 0, icon: ServerIcon, accent: "text-emerald-400", chip: "bg-emerald-500/10 border-emerald-500/30", ring: "hover:border-emerald-500/40" },
    { label: "Online", value: liveTotals?.online ?? 0, icon: Wifi, accent: "text-emerald-400", chip: "bg-emerald-500/10 border-emerald-500/30", ring: "hover:border-emerald-500/40" },
    { label: "Warning", value: liveTotals?.warning ?? 0, icon: Zap, accent: "text-amber-400", chip: "bg-amber-500/10 border-amber-500/30", ring: "hover:border-amber-500/40" },
    { label: "Offline", value: liveTotals?.offline ?? 0, icon: WifiOff, accent: "text-red-400", chip: "bg-red-500/10 border-red-500/30", ring: "hover:border-red-500/40" },
    { label: "Active alerts", value: totals?.active_alerts ?? 0, icon: AlertTriangle, accent: "text-sky-400", chip: "bg-sky-500/10 border-sky-500/30", ring: "hover:border-sky-500/40" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-emerald">System Overview</h1>
          <p className="text-sm text-slate-400">Continuous monitoring & live health metrics across site servers</p>
        </div>
        <div className="flex items-center gap-2.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          Live Stream · {lastUpdated ? lastUpdated.toLocaleTimeString() : " connecting…"}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {loading || !totals
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="flex-row items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-7 w-7 rounded-lg" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-9 w-14" />
                </CardContent>
              </Card>
            ))
          : cards.map(({ label, value, icon: Icon, accent, chip, ring }) => {
              const cardFilter = CARD_FILTERS[label];
              const isActive = cardFilter !== undefined && statusFilter === cardFilter;
              return (
                <Card
                  key={label}
                  role={cardFilter ? "button" : undefined}
                  tabIndex={cardFilter ? 0 : undefined}
                  title={
                    cardFilter === "all"
                      ? "Show all servers"
                      : cardFilter
                        ? `Show ${label.toLowerCase()} servers only`
                        : undefined
                  }
                  onClick={
                    cardFilter
                      ? () =>
                          setStatusFilter((prev) =>
                            cardFilter !== "all" && prev === cardFilter ? "all" : (cardFilter as Server["status"] | "all")
                          )
                      : undefined
                  }
                  onKeyDown={
                    cardFilter
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setStatusFilter((prev) =>
                              cardFilter !== "all" && prev === cardFilter ? "all" : (cardFilter as Server["status"] | "all")
                            );
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5",
                    ring,
                    cardFilter && "cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                    isActive && "border-sky-500/60 bg-sky-500/10 ring-1 ring-sky-400/50 shadow-lg shadow-sky-500/10"
                  )}
                >
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</CardTitle>
                    <div className={cn("rounded-xl border p-2 shadow-inner", chip)}>
                      <Icon className={cn("h-4 w-4", accent)} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-baseline justify-between">
                    <span className={cn("text-3xl font-extrabold tracking-tight", accent)}>{value}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Active</span>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Main Section Header with Filters & View Switcher */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-semibold">Registered Site Servers</CardTitle>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              {filtered.length} total
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
              <button
                onClick={() => setViewMode("table")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  viewMode === "table" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                )}
                title="Table View"
              >
                <List className="h-3.5 w-3.5" />
                <span>Table</span>
              </button>
              <button
                onClick={() => setViewMode("sites")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  viewMode === "sites" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                )}
                title="Site Topology View"
              >
                <Grid className="h-3.5 w-3.5" />
                <span>Site Topology</span>
              </button>
            </div>

            {/* Instant Filter Search input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter servers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-lg border border-slate-700/60 bg-slate-900/70 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-sky-500/60 w-36 sm:w-48"
              />
            </div>

            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">Client: all</option>
              {clients.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">Status: all</option>
              {statuses.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Add agent
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {viewMode === "sites" ? (
            /* Site Topology Grouped Grid View */
            <div className="flex flex-col gap-6">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-48 w-full rounded-xl" />
                  ))}
                </div>
              ) : sitesGrouped.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">
                  No site locations match the current filters.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sitesGrouped.map((g) => (
                    <Card key={g.groupKey} className="border-slate-800 bg-slate-950/60 overflow-hidden">
                      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800/60 bg-slate-900/60 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-1.5">
                              {g.site.client}
                            </h3>
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-slate-500" />
                              {g.site.location}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-xs font-bold text-slate-200">
                              {g.healthScore}% Site Health
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Avg CPU {g.avgCpu.toFixed(1)}% · RAM {g.avgMem.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-8 w-8 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center font-bold text-xs text-emerald-400">
                            {g.healthScore}%
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="p-3 flex flex-col gap-2">
                        {g.servers.map((s) => (
                          <div
                            key={s.id}
                            onClick={() => navigate(`/servers/${s.id}`)}
                            className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-900/80 hover:bg-slate-800/70 hover:border-slate-700 cursor-pointer transition-all duration-150"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <StatusBadge status={s.status} />
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-sm text-slate-200 truncate">
                                  {s.name}
                                </span>
                                <span className="font-mono text-xs text-slate-400 truncate">
                                  {s.hostname} {s.ip_address ? `· ${s.ip_address}` : ""}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 text-xs font-mono">
                              <div className="hidden sm:flex flex-col items-end">
                                <span className="text-sky-400 font-semibold">
                                  CPU {s.latest ? `${s.latest.cpu_percent.toFixed(1)}%` : "—"}
                                </span>
                                <span className="text-purple-400">
                                  RAM {s.latest ? `${s.latest.memory_percent.toFixed(1)}%` : "—"}
                                </span>
                              </div>
                              <div className="flex flex-col items-end text-slate-400">
                                <span>Disk {s.latest ? `${s.latest.disk_percent.toFixed(1)}%` : "—"}</span>
                                <span className="text-[10px] text-slate-500">{formatTime(s.last_seen_at)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Table View */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("status")}>
                    <div className="flex items-center gap-1">
                      Status <ArrowUpDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("name")}>
                    <div className="flex items-center gap-1">
                      Server <ArrowUpDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">Hostname</TableHead>
                  <TableHead className="hidden lg:table-cell">IP</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("cpu")}>
                    <div className="flex items-center justify-end gap-1">
                      CPU <ArrowUpDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </TableHead>
                  <TableHead className="hidden sm:table-cell text-right cursor-pointer select-none" onClick={() => toggleSort("memory")}>
                    <div className="flex items-center justify-end gap-1">
                      Memory <ArrowUpDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-right cursor-pointer select-none" onClick={() => toggleSort("disk")}>
                    <div className="flex items-center justify-end gap-1">
                      Disk <ArrowUpDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-right">Disk I/O</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Uptime</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("last_seen")}>
                    <div className="flex items-center gap-1">
                      Last seen <ArrowUpDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 13 }).map((_, j) => {
                        const hide = [1, 4, 5, 7, 8, 9, 10].includes(j);
                        return (
                          <TableCell key={j} className={hide ? "hidden md:table-cell" : undefined}>
                            <Skeleton className={cn("h-4 w-full max-w-[120px]", hide && "md:max-w-none")} />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                ) : (
                  <>
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={13} className="py-8 text-center text-slate-500">
                          No agents match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((s) => (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer hover:bg-slate-800/50 transition-colors"
                        onClick={() => navigate(`/servers/${s.id}`)}
                      >
                        <TableCell>
                          <span className="font-medium text-slate-200">{siteName(s.site_id)}</span>
                        </TableCell>
                        <TableCell className="hidden text-slate-400 md:table-cell">{siteLocation(s.site_id)}</TableCell>
                        <TableCell><StatusBadge status={s.status} /></TableCell>
                        <TableCell className="font-medium text-slate-100">{s.name}</TableCell>
                        <TableCell className="hidden font-mono text-xs text-slate-300 sm:table-cell">{s.hostname}</TableCell>
                        <TableCell className="hidden font-mono text-xs text-slate-400 lg:table-cell">
                          {s.ip_address ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-sky-400">
                          {s.latest ? `${s.latest.cpu_percent.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono font-semibold text-purple-400 sm:table-cell">
                          {s.latest ? `${s.latest.memory_percent.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono font-semibold text-amber-400 md:table-cell">
                          {s.latest ? `${s.latest.disk_percent.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono text-emerald-400 md:table-cell">
                          {s.latest ? `${s.latest.disk_read_rate_mb ?? 0}/${s.latest.disk_write_rate_mb ?? 0} MB/s` : "—"}
                        </TableCell>
                        <TableCell className="hidden text-right lg:table-cell">
                          {s.latest ? formatUptime(s.latest.uptime_seconds) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {formatTime(s.last_seen_at)}
                        </TableCell>
                        <TableCell>
                          {isAdmin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(s);
                              }}
                              title="Remove agent"
                              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-sm font-semibold">Register agent</h2>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setRegistered(null);
                  setAddError(null);
                }}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {registered ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-emerald-400">
                  Agent <span className="font-semibold">{registered.name}</span> registered. Set
                  these values on the agent in the site server — the key is shown only once.
                </p>
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all font-mono text-xs text-emerald-300">
                      {registered.key}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copy(registered.key)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-emerald-300">{`SITE_ID=${registered.siteId}
SERVER_ID=${registered.serverId}
API_URL=${window.location.origin}/api/v1
API_KEY=${registered.key}
MONITORING_INTERVAL=60
MONITORED_SERVICES=${form.monitored_services.trim()}`}</pre>
                <Button
                  onClick={() => {
                    setShowAdd(false);
                    setRegistered(null);
                  }}
                  className="w-full"
                >
                  Done
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-slate-400">Client name</Label>
                  <Input
                    value={form.client}
                    onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                    placeholder="e.g. samsonite"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-slate-400">Location</Label>
                  <Input
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="e.g. Nashik"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-slate-400">Equipment name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Conveyor Line 01"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-slate-400">
                    Monitored services{" "}
                    <span className="text-slate-600">(optional, comma-separated)</span>
                  </Label>
                  <Input
                    value={form.monitored_services}
                    onChange={(e) => setForm((f) => ({ ...f, monitored_services: e.target.value }))}
                    placeholder="nginx,postgresql"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Hostname & IP are auto-detected from the agent's first request.
                </p>
                {addError && <p className="text-xs text-red-400">{addError}</p>}
                <Button
                  onClick={addAgent}
                  disabled={adding || !form.client || !form.location || !form.name}
                  className="w-full"
                >
                  <Rocket className="mr-2 h-4 w-4" />
                  {adding ? "Registering…" : "Add agent"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-red-500/30 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center gap-2 pb-3">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h2 className="text-sm font-semibold">Remove agent</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Remove agent <span className="font-semibold text-slate-200">{deleteTarget.name}</span>?
              This permanently deletes the server with all its metrics, services, alerts and API
              keys. This cannot be undone.
            </p>
            {deleteError && <p className="mt-2 text-xs text-red-400">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={deleting}
                onClick={confirmDelete}
                className="bg-red-600 hover:bg-red-500"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}