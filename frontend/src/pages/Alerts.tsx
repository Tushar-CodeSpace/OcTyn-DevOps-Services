import { useEffect, useState } from "react";
import { Search, AlertTriangle, Info, ShieldAlert, CheckCircle2, Activity } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { Alert, Server, Site } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityBadge } from "@/components/StatusBadge";
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

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [serverMap, setServerMap] = useState<Record<string, Server>>({});
  const [siteMap, setSiteMap] = useState<Record<string, Site>>({});
  const [filter, setFilter] = useState<"active" | "resolved" | "all">("active");
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "warning" | "info">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [a, s, st] = await Promise.all([
        apiFetch<Alert[]>(`/alerts${filter !== "all" ? `?status=${filter}` : ""}`),
        apiFetch<Server[]>("/servers"),
        apiFetch<Site[]>("/sites"),
      ]);
      setAlerts(a);
      setServerMap(Object.fromEntries(s.map((x) => [x.id, x])));
      setSiteMap(Object.fromEntries(st.map((x) => [x.id, x])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on("alert_opened", load);
    socket.on("alert_resolved", load);
    return () => {
      socket.off("alert_opened", load);
      socket.off("alert_resolved", load);
    };
  }, [filter]);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.filter((a) => a.severity === "info").length;

  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter !== "all" && a.severity !== severityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const srv = serverMap[a.server_id];
      const site = srv ? siteMap[srv.site_id] : undefined;
      const match =
        a.message.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        (srv && (srv.name.toLowerCase().includes(q) || srv.hostname.toLowerCase().includes(q))) ||
        (site && (site.client.toLowerCase().includes(q) || site.location.toLowerCase().includes(q)));
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-sky">Master Logs</h1>
          <p className="text-sm text-slate-400">Real-time system incident and auto-resolution workspace</p>
        </div>
        <div className="flex rounded-full border border-white/10 bg-slate-900/80 p-1 backdrop-blur-md">
          {(["active", "resolved", "all"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilter(f)}
              className={filter === f ? "bg-sky-600 font-bold text-white shadow-md shadow-sky-500/20" : "text-slate-400 hover:text-slate-200"}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Incident Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-red-500/30 bg-slate-900/90">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Critical Incidents</span>
              <div className="text-2xl font-extrabold text-red-400 mt-1">{criticalCount}</div>
            </div>
            <div className="p-2.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-slate-900/90">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Warnings</span>
              <div className="text-2xl font-extrabold text-amber-400 mt-1">{warningCount}</div>
            </div>
            <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-sky-500/30 bg-slate-900/90">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Info Notices</span>
              <div className="text-2xl font-extrabold text-sky-400 mt-1">{infoCount}</div>
            </div>
            <div className="p-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <Info className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-3">
          <CardTitle className="text-sm">
            {loading ? "Loading…" : `${filteredAlerts.length} master logs`}
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            {/* Severity filter pills */}
            <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
              {(["all", "critical", "warning", "info"] as const).map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={cn(
                    "rounded-md px-2.5 py-0.5 text-xs font-medium transition-all capitalize",
                    severityFilter === sev ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Search query input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search master logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-lg border border-slate-700/60 bg-slate-900 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-sky-500/60 w-44"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Server / Site</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Resolution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <>
                  {filteredAlerts.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-500">No logs match the criteria.</TableCell></TableRow>
                  )}
                  {filteredAlerts.map((a) => (
                    <TableRow key={a.id} className="hover:bg-slate-800/40">
                      <TableCell><SeverityBadge severity={a.severity} /></TableCell>
                      <TableCell>
                        {(() => {
                          const srv = serverMap[a.server_id];
                          const site = srv ? siteMap[srv.site_id] : undefined;
                          return (
                            <div className="flex flex-col leading-tight">
                              <span className="font-medium text-slate-200">
                                {srv ? srv.name : a.server_id.slice(0, 8)}
                              </span>
                              <span className="text-xs text-slate-500">
                                {[srv?.hostname, site?.client, site?.location].filter(Boolean).join(" · ") || "—"}
                              </span>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="font-medium text-slate-300">{a.message}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === "active" ? "red" : "green"}>{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">{formatTime(a.created_at)}</TableCell>
                      <TableCell>
                        {a.status === "resolved" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            Auto-Resolved {a.resolved_at ? `(${formatTime(a.resolved_at)})` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                            <Activity className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
                            Active (Auto-Monitoring)
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}