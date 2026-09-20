import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Laptop,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/lib/auth";
import { showToast } from "@/components/ToastHost";
import { cn } from "@/lib/utils";

const toast = ({ title, message, variant }: { title: string; message?: string; variant?: "success" | "error" | "info" }) => {
  showToast({
    severity: variant === "error" ? "critical" : variant === "success" ? "info" : "info",
    title,
    message: message || "",
  });
};

interface ServerItem {
  id: string;
  site_id: string;
  name: string;
  hostname: string;
  ip_address?: string;
  environment?: string;
  qa_role?: string;
  qa_test_url?: string;
  status: "online" | "warning" | "offline" | "unknown";
  last_seen_at?: string;
  created_at?: string;
  updated_at?: string;
}

interface QAServerTelemetry {
  server: ServerItem;
  site_name: string;
  latest_cpu?: number;
  latest_ram?: number;
  active_software?: string;
  active_branch?: string;
  last_deployed_at?: string;
  latest_qa_verdict?: string;
}

interface DeploymentLogEntry {
  ts: string;
  stage: string;
  line: string;
  level: "info" | "warn" | "error" | "success";
}

interface QATestResult {
  verdict: "passed" | "failed" | "in_progress" | "blocked";
  tester_id: string;
  tester_email: string;
  tested_at: string;
  test_notes?: string;
  test_cases_run?: number;
  bugs_found?: number;
}

interface DeploymentRecord {
  id: string;
  batch_id?: string;
  server_id: string;
  server_name: string;
  site_name: string;
  software_id: string;
  software_name: string;
  status: "pending_approval" | "pending" | "running" | "success" | "failed" | "cancelled" | "rejected";
  environment: string;
  components_selected: string[];
  branches: Record<string, string>;
  client_name?: string;
  machine_type?: string;
  triggered_by: string;
  started_at: string;
  finished_at?: string;
  duration_seconds?: number;
  exit_code?: number;
  logs?: DeploymentLogEntry[];
  qa_test_result?: QATestResult;
}

interface SoftwareDefinition {
  id: string;
  name: string;
  description?: string;
  components: Array<{
    name: string;
    type: string;
    default_branch: string;
    repo_url: string;
  }>;
}

interface QAOverviewResponse {
  qa_servers: QAServerTelemetry[];
  recent_deployments: DeploymentRecord[];
  stats: {
    total_qa_servers: number;
    online_qa_servers: number;
    offline_qa_servers: number;
    active_deploying: number;
    total_qa_tests: number;
    passed_tests: number;
    failed_tests: number;
    in_progress_tests: number;
  };
}

export default function QATestingPage() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"runners" | "history">("runners");

  // Overview Data
  const [qaServers, setQaServers] = useState<QAServerTelemetry[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [stats, setStats] = useState<QAOverviewResponse["stats"]>({
    total_qa_servers: 0,
    online_qa_servers: 0,
    offline_qa_servers: 0,
    active_deploying: 0,
    total_qa_tests: 0,
    passed_tests: 0,
    failed_tests: 0,
    in_progress_tests: 0,
  });

  // Software & All Servers (for modals)
  const [allSoftwares, setAllSoftwares] = useState<SoftwareDefinition[]>([]);
  const [allSiteServers, setAllSiteServers] = useState<ServerItem[]>([]);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<string>("all");

  // Deploy to QA Modal
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [selectedSoftwareId, setSelectedSoftwareId] = useState("");
  const [targetServerIds, setTargetServerIds] = useState<string[]>([]);
  const [customBranchInput, setCustomBranchInput] = useState("");
  const [deploying, setDeploying] = useState(false);

  // Manage QA Nodes Modal
  const [manageNodesModalOpen, setManageNodesModalOpen] = useState(false);
  const [manageSearch, setManageSearch] = useState("");
  const [updatingServerId, setUpdatingServerId] = useState<string | null>(null);

  // QA Verdict Modal
  const [verdictModalOpen, setVerdictModalOpen] = useState(false);
  const [targetDeployment, setTargetDeployment] = useState<DeploymentRecord | null>(null);
  const [verdictSelection, setVerdictSelection] = useState<"passed" | "failed" | "in_progress" | "blocked">("passed");
  const [testNotes, setTestNotes] = useState("");
  const [testCasesRun, setTestCasesRun] = useState<number | undefined>(undefined);
  const [bugsFound, setBugsFound] = useState<number | undefined>(undefined);
  const [savingVerdict, setSavingVerdict] = useState(false);

  // Live Console Drawer
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [activeDeployment, setActiveDeployment] = useState<DeploymentRecord | null>(null);
  const [activeLogs, setActiveLogs] = useState<DeploymentLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  const fetchQAData = async () => {
    try {
      const data = await apiFetch<QAOverviewResponse>("/api/v1/qa/overview");
      if (data) {
        setQaServers(data.qa_servers || []);
        setDeployments(data.recent_deployments || []);
        setStats(data.stats || stats);
      }
    } catch (err: any) {
      toast({ title: "Failed to load QA overview", message: err.message, variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  const loadAuxData = async () => {
    try {
      const [swRes, srvRes] = await Promise.all([
        apiFetch<SoftwareDefinition[]>("/api/v1/deployments/softwares"),
        apiFetch<ServerItem[]>("/api/v1/servers"),
      ]);
      setAllSoftwares(swRes || []);
      setAllSiteServers(srvRes || []);
      if (swRes && swRes.length > 0 && !selectedSoftwareId) {
        setSelectedSoftwareId(swRes[0].id);
      }
    } catch (err) {
      // Ignored
    }
  };

  useEffect(() => {
    fetchQAData();
    loadAuxData();
  }, []);

  // Real-time Socket.IO Listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onDeploymentStatus = (data: { id: string; status: string }) => {
      setDeployments((prev) =>
        prev.map((d) => (d.id === data.id ? { ...d, status: data.status as any } : d))
      );
      if (activeDeployment && activeDeployment.id === data.id) {
        setActiveDeployment((prev) => (prev ? { ...prev, status: data.status as any } : null));
      }
    };

    const onDeploymentLog = (data: { id: string; entry: DeploymentLogEntry }) => {
      if (activeDeployment && activeDeployment.id === data.id) {
        setActiveLogs((prev) => [...prev, data.entry]);
      }
    };

    const onQAVerdictUpdated = (data: { id: string; verdict: string; test_result: QATestResult }) => {
      setDeployments((prev) =>
        prev.map((d) => (d.id === data.id ? { ...d, qa_test_result: data.test_result } : d))
      );
    };

    const onServerUpdated = () => {
      fetchQAData();
    };

    socket.on("deployment_status", onDeploymentStatus);
    socket.on("deployment_log", onDeploymentLog);
    socket.on("qa_verdict_updated", onQAVerdictUpdated);
    socket.on("server_updated", onServerUpdated);

    return () => {
      socket.off("deployment_status", onDeploymentStatus);
      socket.off("deployment_log", onDeploymentLog);
      socket.off("qa_verdict_updated", onQAVerdictUpdated);
      socket.off("server_updated", onServerUpdated);
    };
  }, [activeDeployment]);

  // Auto-scroll console
  useEffect(() => {
    if (autoScroll && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeLogs, autoScroll]);

  // Filtered QA Deployments
  const filteredDeployments = useMemo(() => {
    return deployments.filter((d) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        d.software_name.toLowerCase().includes(q) ||
        d.server_name.toLowerCase().includes(q) ||
        Object.values(d.branches || {}).some((b) => b.toLowerCase().includes(q));

      const matchVerdict =
        verdictFilter === "all" ||
        (verdictFilter === "pending" && (!d.qa_test_result || d.qa_test_result.verdict === "in_progress")) ||
        d.qa_test_result?.verdict === verdictFilter;

      return matchSearch && matchVerdict;
    });
  }, [deployments, search, verdictFilter]);

  // Open Live Console Drawer
  const openConsole = async (dep: DeploymentRecord) => {
    setActiveDeployment(dep);
    setActiveLogs(dep.logs || []);
    setConsoleOpen(true);
    try {
      const full = await apiFetch<DeploymentRecord>(`/api/v1/deployments/${dep.id}`);
      if (full && full.logs) {
        setActiveLogs(full.logs);
      }
    } catch (err) {
      // Keep existing logs
    }
  };

  // Trigger Fast-Track QA Deployment
  const handleDeployToQA = async () => {
    if (!selectedSoftwareId) {
      toast({ title: "Please select software", variant: "error" });
      return;
    }
    if (targetServerIds.length === 0) {
      toast({ title: "Please select at least one QA runner node", variant: "error" });
      return;
    }

    const branch = customBranchInput.trim() || "main";
    setDeploying(true);

    try {
      const res = await apiFetch<DeploymentRecord[]>("/api/v1/qa/deployments", {
        method: "POST",
        body: JSON.stringify({
          software_id: selectedSoftwareId,
          server_ids: targetServerIds,
          branch: branch,
        }),
      });

      toast({
        title: "QA Deployment Launched!",
        message: `Fast-track build for '${branch}' dispatched to ${res.length} QA agent(s).`,
        variant: "success",
      });

      setDeployModalOpen(false);
      fetchQAData();

      if (res && res.length > 0) {
        openConsole(res[0]);
      }
    } catch (err: any) {
      toast({ title: "Deployment failed", message: err.message, variant: "error" });
    } finally {
      setDeploying(false);
    }
  };

  // Toggle QA Designation for a Node
  const handleToggleQADesignation = async (server: ServerItem, isQA: boolean, role?: string, url?: string) => {
    setUpdatingServerId(server.id);
    try {
      await apiFetch<ServerItem>(`/api/v1/qa/servers/${server.id}/designate`, {
        method: "POST",
        body: JSON.stringify({
          is_qa: isQA,
          qa_role: role || (isQA ? "QA Runner Node" : null),
          qa_test_url: url || null,
        }),
      });

      toast({
        title: isQA ? "Designated as QA Runner" : "Returned to Production",
        message: `${server.hostname} is now ${isQA ? "a QA / Testing agent" : "in the production pool"}.`,
        variant: "success",
      });

      await fetchQAData();
      await loadAuxData();
    } catch (err: any) {
      toast({ title: "Failed to update node designation", message: err.message, variant: "error" });
    } finally {
      setUpdatingServerId(null);
    }
  };

  // Open Verdict Sign-Off Modal
  const openVerdictModal = (dep: DeploymentRecord) => {
    setTargetDeployment(dep);
    setVerdictSelection(dep.qa_test_result?.verdict || "passed");
    setTestNotes(dep.qa_test_result?.test_notes || "");
    setTestCasesRun(dep.qa_test_result?.test_cases_run || undefined);
    setBugsFound(dep.qa_test_result?.bugs_found || undefined);
    setVerdictModalOpen(true);
  };

  // Save QA Verdict
  const handleSaveVerdict = async () => {
    if (!targetDeployment) return;
    setSavingVerdict(true);
    try {
      const updated = await apiFetch<DeploymentRecord>(`/api/v1/qa/deployments/${targetDeployment.id}/verdict`, {
        method: "PATCH",
        body: JSON.stringify({
          verdict: verdictSelection,
          test_notes: testNotes,
          test_cases_run: testCasesRun ? Number(testCasesRun) : null,
          bugs_found: bugsFound ? Number(bugsFound) : 0,
        }),
      });

      toast({
        title: `QA Verdict Recorded: ${verdictSelection.toUpperCase()}`,
        message: `Test verdict updated for ${targetDeployment.software_name}.`,
        variant: "success",
      });

      setDeployments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setVerdictModalOpen(false);
      fetchQAData();
    } catch (err: any) {
      toast({ title: "Failed to record verdict", message: err.message, variant: "error" });
    } finally {
      setSavingVerdict(false);
    }
  };

  const getVerdictBadge = (verdict?: string) => {
    switch (verdict) {
      case "passed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-xs shadow-emerald-500/10">
            <CheckCircle2 className="w-3.5 h-3.5" /> Passed
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-xs shadow-rose-500/10">
            <XCircle className="w-3.5 h-3.5" /> Failed
          </span>
        );
      case "in_progress":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20 shadow-xs shadow-amber-500/10 animate-pulse">
            <Clock className="w-3.5 h-3.5" /> Testing in Progress
          </span>
        );
      case "blocked":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-300 border border-orange-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> Blocked
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/60 text-slate-400 border border-slate-700/50">
            Pending Test
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">
            <Activity className="w-3 h-3" /> Deploying...
          </span>
        );
      case "success":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Deployed
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3 h-3" /> Build Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 p-6 sm:p-8 border border-slate-800/80 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20">
                <FlaskConical className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
                  QA & Testing Environment
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Isolated Test Pool
                  </span>
                </h1>
                <p className="text-sm text-slate-400">
                  Dedicated test runner agents, fast-track Git deployments, live build streaming, and QA sign-offs.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                const qaIds = qaServers.map((s) => s.server.id);
                setTargetServerIds(qaIds.length > 0 ? [qaIds[0]] : []);
                setDeployModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/25 transition-all active:scale-95 cursor-pointer"
            >
              <Rocket className="w-4 h-4" />
              Deploy Build to QA
            </button>

            {isAdmin && (
              <button
                onClick={() => setManageNodesModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-medium text-sm bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 transition-all cursor-pointer"
              >
                <Settings className="w-4 h-4 text-slate-400" />
                Manage QA Nodes
                <span className="ml-1 text-xs px-1.5 py-0.5 rounded-md bg-slate-700 text-slate-300">
                  {qaServers.length}
                </span>
              </button>
            )}

            <button
              onClick={() => {
                fetchQAData();
                loadAuxData();
              }}
              className="p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700/50 transition-colors cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* 4 Quick Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-800/60">
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">QA Runner Agents</p>
              <p className="text-xl font-bold text-white">{stats.total_qa_servers}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Online Test Nodes</p>
              <p className="text-xl font-bold text-emerald-400">
                {stats.online_qa_servers} <span className="text-xs font-normal text-slate-400">/ {stats.total_qa_servers}</span>
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Active Builds</p>
              <p className="text-xl font-bold text-indigo-300">{stats.active_deploying}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Passed QA Tests</p>
              <p className="text-xl font-bold text-white">
                {stats.passed_tests}{" "}
                <span className="text-xs font-normal text-slate-400">
                  ({stats.total_qa_tests > 0 ? Math.round((stats.passed_tests / stats.total_qa_tests) * 100) : 0}%)
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("runners")}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-2",
              activeTab === "runners"
                ? "bg-slate-800 text-emerald-400 border border-slate-700 shadow-xs"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            )}
          >
            <Server className="w-4 h-4" />
            QA Test Runners ({qaServers.length})
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-2",
              activeTab === "history"
                ? "bg-slate-800 text-emerald-400 border border-slate-700 shadow-xs"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            )}
          >
            <Clock className="w-4 h-4" />
            QA Builds & Test Results ({deployments.length})
          </button>
        </div>

        {activeTab === "history" && (
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search software, branch, runner..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-900/80 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500/50 w-48 sm:w-64"
              />
            </div>

            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500/50"
            >
              <option value="all">All Verdicts</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="in_progress">In Progress</option>
              <option value="pending">Pending Sign-off</option>
            </select>
          </div>
        )}
      </div>

      {/* TAB 1: QA RUNNER AGENTS */}
      {activeTab === "runners" && (
        <div className="space-y-4">
          {qaServers.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center">
                <Server className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-white">No QA Runner Agents Designated</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Designate one or more remote site servers as QA runners so your team can rapidly pull and test Git branches.
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setManageNodesModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Designate Servers as QA Runners
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {qaServers.map((runner) => {
                const s = runner.server;
                const isOnline = s.status === "online";

                return (
                  <div
                    key={s.id}
                    className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700/80 shadow-lg hover:shadow-xl transition-all space-y-4 relative group"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm",
                            isOnline
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          )}
                        >
                          <Laptop className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">
                            {s.name || s.hostname}
                          </h3>
                          <p className="text-xs text-slate-400 flex items-center gap-1.5">
                            <span>{s.hostname}</span>
                            <span>•</span>
                            <span className="font-mono text-slate-500">{s.ip_address || "No IP"}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                            isOnline
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          )}
                        >
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              isOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                            )}
                          />
                          {s.status}
                        </span>
                      </div>
                    </div>

                    {/* Role / Lab Tag */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium">
                        {s.qa_role || "QA Test Runner"}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400">
                        {runner.site_name}
                      </span>
                    </div>

                    {/* Hardware Telemetry */}
                    <div className="grid grid-cols-2 gap-3 py-2 border-y border-slate-800/60">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">CPU</span>
                          <span className="font-mono text-slate-200">
                            {runner.latest_cpu !== undefined && runner.latest_cpu !== null
                              ? `${runner.latest_cpu.toFixed(0)}%`
                              : "—"}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              (runner.latest_cpu || 0) > 85 ? "bg-rose-500" : "bg-emerald-400"
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, runner.latest_cpu || 0))}%` }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">RAM</span>
                          <span className="font-mono text-slate-200">
                            {runner.latest_ram !== undefined && runner.latest_ram !== null
                              ? `${runner.latest_ram.toFixed(0)}%`
                              : "—"}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              (runner.latest_ram || 0) > 85 ? "bg-rose-500" : "bg-cyan-400"
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, runner.latest_ram || 0))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Active Build & Git Branch */}
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Active Deployed Build:</span>
                        <span className="font-semibold text-slate-200">
                          {runner.active_software || "None"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-slate-400">
                        <span>Git Branch:</span>
                        {runner.active_branch ? (
                          <span className="inline-flex items-center gap-1 font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            <GitBranch className="w-3 h-3" />
                            {runner.active_branch}
                          </span>
                        ) : (
                          <span className="text-slate-500">Not deployed</span>
                        )}
                      </div>

                      {runner.latest_qa_verdict && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-slate-400">Latest Verdict:</span>
                          {getVerdictBadge(runner.latest_qa_verdict)}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        onClick={() => {
                          setTargetServerIds([s.id]);
                          setDeployModalOpen(true);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors cursor-pointer"
                      >
                        <Rocket className="w-3.5 h-3.5" />
                        Deploy Build
                      </button>

                      {s.qa_test_url ? (
                        <a
                          href={s.qa_test_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1 py-2 px-3 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition-colors"
                          title="Open Test Application in New Tab"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          Test App
                        </a>
                      ) : null}

                      <a
                        href={`/servers/${s.id}`}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition-colors"
                        title="View Node Telemetry & Logs"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: QA DEPLOYMENTS & TEST RESULTS HISTORY */}
      {activeTab === "history" && (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-xl">
          {filteredDeployments.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Clock className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-medium">No QA deployments found</p>
              <p className="text-xs text-slate-500">
                Trigger a deployment to a designated QA agent to begin testing.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Software</th>
                    <th className="py-3.5 px-4">Git Branch</th>
                    <th className="py-3.5 px-4">QA Runner Node</th>
                    <th className="py-3.5 px-4">Build Status</th>
                    <th className="py-3.5 px-4">QA Test Verdict</th>
                    <th className="py-3.5 px-4">Deployed By</th>
                    <th className="py-3.5 px-4">Time</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredDeployments.map((dep) => {
                    const branch = Object.values(dep.branches || {})[0] || "main";
                    const verdict = dep.qa_test_result?.verdict;

                    return (
                      <tr key={dep.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-semibold text-white">
                          {dep.software_name}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            <GitBranch className="w-3 h-3 text-emerald-400" />
                            {branch}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          <div>{dep.server_name}</div>
                          <div className="text-[10px] text-slate-500">{dep.site_name}</div>
                        </td>
                        <td className="py-3 px-4">{getStatusBadge(dep.status)}</td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => openVerdictModal(dep)}
                            className="group flex items-center gap-1.5 cursor-pointer text-left"
                            title="Click to Record or Update QA Test Verdict"
                          >
                            {getVerdictBadge(verdict)}
                            <span className="text-[10px] text-slate-500 group-hover:text-slate-300 underline underline-offset-2">
                              {verdict ? "Edit" : "Sign off"}
                            </span>
                          </button>
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {dep.triggered_by}
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                          {new Date(dep.started_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => openConsole(dep)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                            title="Open Real-time Build Console"
                          >
                            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                            Console
                          </button>
                          <button
                            onClick={() => openVerdictModal(dep)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Sign Off
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: DEPLOY BUILD TO QA AGENT */}
      {deployModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                  <Rocket className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Deploy Build to QA Environment</h3>
                  <p className="text-xs text-slate-400">
                    Fast-track deployment — code will be pulled from Git and built immediately on QA nodes.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDeployModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Software Selection */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300">Software Application</label>
                <select
                  value={selectedSoftwareId}
                  onChange={(e) => setSelectedSoftwareId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs"
                >
                  {allSoftwares.map((sw) => (
                    <option key={sw.id} value={sw.id}>
                      {sw.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Git Branch Specification */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                    Git Branch to Deploy & Test
                  </label>
                  <span className="text-[11px] text-slate-500">Feature branch, PR, or tag</span>
                </div>

                <input
                  type="text"
                  placeholder="e.g. feature/rejection-filter, v2.4-qa, develop"
                  value={customBranchInput}
                  onChange={(e) => setCustomBranchInput(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono text-xs"
                />

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-slate-500">Suggested:</span>
                  {["main", "staging", "develop", "qa-release"].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setCustomBranchInput(b)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer",
                        customBranchInput === b
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : "bg-slate-800 text-slate-400 border-slate-700/60 hover:text-slate-200"
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target QA Nodes Multi-Select */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-300">Target QA Runner Agent(s)</label>
                  <span className="text-[11px] text-slate-500">{targetServerIds.length} selected</span>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
                  {qaServers.length === 0 ? (
                    <p className="p-3 text-center text-slate-500">
                      No QA agents configured yet. Use "Manage QA Nodes" to designate servers.
                    </p>
                  ) : (
                    qaServers.map((runner) => {
                      const sid = runner.server.id;
                      const isSelected = targetServerIds.includes(sid);
                      const isOnline = runner.server.status === "online";

                      return (
                        <label
                          key={sid}
                          className={cn(
                            "flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all",
                            isSelected
                              ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                              : "bg-slate-900/60 border-slate-800/60 text-slate-300 hover:bg-slate-900"
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setTargetServerIds((prev) => [...prev, sid]);
                                } else {
                                  setTargetServerIds((prev) => prev.filter((id) => id !== sid));
                                }
                              }}
                              className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                            />
                            <div>
                              <div className="font-semibold">{runner.server.name || runner.server.hostname}</div>
                              <div className="text-[10px] text-slate-400">{runner.server.hostname} • {runner.site_name}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "w-2 h-2 rounded-full",
                                isOnline ? "bg-emerald-400" : "bg-rose-400"
                              )}
                            />
                            <span className="text-[10px] text-slate-400">{runner.server.qa_role || "QA"}</span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeployModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeployToQA}
                disabled={deploying || targetServerIds.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 hover:from-emerald-400 hover:to-teal-400 transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                {deploying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Dispatching build...
                  </>
                ) : (
                  <>
                    <Rocket className="w-3.5 h-3.5" />
                    Deploy to QA Agent
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: MANAGE QA NODES (DESIGNATE / UN-DESIGNATE) */}
      {manageNodesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Manage QA & Test Runner Nodes</h3>
                  <p className="text-xs text-slate-400">
                    Designate which edge servers act exclusively as QA runners for testing Git builds.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setManageNodesModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter site servers by hostname, name, IP..."
                  value={manageSearch}
                  onChange={(e) => setManageSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs"
                />
              </div>

              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {allSiteServers
                  .filter((s) => {
                    const q = manageSearch.toLowerCase();
                    return (
                      !q ||
                      s.name.toLowerCase().includes(q) ||
                      s.hostname.toLowerCase().includes(q) ||
                      (s.ip_address && s.ip_address.toLowerCase().includes(q))
                    );
                  })
                  .map((srv) => {
                    const isQA = srv.environment === "qa";
                    const isUpdating = updatingServerId === srv.id;

                    return (
                      <div
                        key={srv.id}
                        className={cn(
                          "p-3 rounded-xl border flex items-center justify-between gap-4 transition-colors",
                          isQA
                            ? "bg-emerald-500/5 border-emerald-500/30"
                            : "bg-slate-950/60 border-slate-800/80"
                        )}
                      >
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">
                              {srv.name || srv.hostname}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] px-2 py-0.5 rounded-full font-semibold",
                                isQA
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-slate-800 text-slate-400"
                              )}
                            >
                              {isQA ? "QA Runner" : "Production"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono">
                            {srv.hostname} • {srv.ip_address || "No IP"}
                          </p>

                          {isQA && srv.qa_role && (
                            <p className="text-[11px] text-indigo-300">
                              Role: <span className="font-medium">{srv.qa_role}</span>
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            disabled={isUpdating}
                            onClick={() => handleToggleQADesignation(srv, !isQA)}
                            className={cn(
                              "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer",
                              isQA
                                ? "bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30"
                                : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30"
                            )}
                          >
                            {isUpdating
                              ? "Updating..."
                              : isQA
                              ? "Remove from QA"
                              : "Designate as QA"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setManageNodesModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: RECORD QA TEST VERDICT & SIGN-OFF */}
      {verdictModalOpen && targetDeployment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden space-y-5 p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">QA Testing Sign-Off</h3>
                  <p className="text-xs text-slate-400">
                    Record verification verdict for {targetDeployment.software_name} ({Object.values(targetDeployment.branches || {})[0] || "main"}).
                  </p>
                </div>
              </div>
              <button
                onClick={() => setVerdictModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Verdict Selector Chips */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300">Test Result Verdict</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: "passed", label: "Passed", icon: CheckCircle2, color: "emerald" },
                    { id: "failed", label: "Failed", icon: XCircle, color: "rose" },
                    { id: "in_progress", label: "In Progress", icon: Clock, color: "amber" },
                    { id: "blocked", label: "Blocked", icon: AlertTriangle, color: "orange" },
                  ].map((v) => {
                    const Icon = v.icon;
                    const active = verdictSelection === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVerdictSelection(v.id as any)}
                        className={cn(
                          "p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 font-semibold text-xs transition-all cursor-pointer",
                          active
                            ? v.id === "passed"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20"
                              : v.id === "failed"
                              ? "bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm shadow-rose-500/20"
                              : v.id === "in_progress"
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                              : "bg-orange-500/20 text-orange-300 border-orange-500/40"
                            : "bg-slate-950/60 text-slate-400 border-slate-800 hover:bg-slate-900 hover:text-slate-200"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Metrics: Test Cases & Bugs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Test Cases Executed</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 15"
                    value={testCasesRun !== undefined ? testCasesRun : ""}
                    onChange={(e) => setTestCasesRun(e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Bugs / Issues Found</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 0"
                    value={bugsFound !== undefined ? bugsFound : ""}
                    onChange={(e) => setBugsFound(e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>

              {/* Testing Notes / Observations */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-medium">QA Notes & Observations</label>
                <textarea
                  rows={3}
                  placeholder="Describe test scenarios performed, edge cases validated, or reproduction steps if failed..."
                  value={testNotes}
                  onChange={(e) => setTestNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setVerdictModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveVerdict}
                disabled={savingVerdict}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                {savingVerdict ? "Recording..." : "Save QA Sign-Off"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER: REAL-TIME DEPLOYMENT LOG CONSOLE */}
      {consoleOpen && activeDeployment && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  {activeDeployment.software_name}
                  {getStatusBadge(activeDeployment.status)}
                </h3>
                <p className="text-xs text-slate-400">
                  Target: <span className="text-slate-200">{activeDeployment.server_name}</span> • Branch:{" "}
                  <span className="font-mono text-emerald-400">
                    {Object.values(activeDeployment.branches || {})[0] || "main"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoScroll((prev) => !prev)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer",
                  autoScroll
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                )}
              >
                Auto-scroll: {autoScroll ? "ON" : "OFF"}
              </button>
              <button
                onClick={() => setConsoleOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Console Stream Area */}
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto bg-slate-950 text-slate-300 space-y-1.5 select-text">
            {activeLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-600">
                Waiting for QA agent to start pull & build stream...
              </div>
            ) : (
              activeLogs.map((log, index) => {
                const isError = log.level === "error";
                const isSuccess = log.level === "success";
                const isWarn = log.level === "warn";

                return (
                  <div
                    key={index}
                    className={cn(
                      "flex items-start gap-2 py-0.5 leading-relaxed",
                      isError && "text-rose-400 bg-rose-500/5 px-2 rounded",
                      isSuccess && "text-emerald-400 bg-emerald-500/5 px-2 rounded",
                      isWarn && "text-amber-300"
                    )}
                  >
                    <span className="text-slate-600 select-none text-[10px] whitespace-nowrap">
                      {new Date(log.ts).toLocaleTimeString()}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.2 rounded font-bold uppercase select-none shrink-0",
                        log.stage === "GIT"
                          ? "bg-cyan-500/20 text-cyan-300"
                          : log.stage === "BUILD"
                          ? "bg-purple-500/20 text-purple-300"
                          : log.stage === "PRECHECK"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-slate-800 text-slate-400"
                      )}
                    >
                      {log.stage}
                    </span>
                    <span className="whitespace-pre-wrap break-all flex-1">{log.line}</span>
                  </div>
                );
              })
            )}
            <div ref={consoleBottomRef} />
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
            <div>
              Status: <span className="font-semibold text-slate-200">{activeDeployment.status}</span>
            </div>
            <button
              onClick={() => openVerdictModal(activeDeployment)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Sign Off QA Test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
