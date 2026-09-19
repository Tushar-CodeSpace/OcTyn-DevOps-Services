import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CheckSquare,
  Clock,
  Code2,
  Copy,
  GitBranch,
  Globe2,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server as ServerIcon,
  Square,
  StopCircle,
  Terminal as TerminalIcon,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { showToast } from "@/components/ToastHost";
import { getSocket } from "@/lib/socket";
import type {
  DeploymentLogEntry,
  DeploymentRecord,
  Server,
  Site,
  SoftwareComponent,
  SoftwareConfigRepo,
  SoftwareDefinition,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActiveTab = "history" | "softwares";
type DeployMode = "single" | "multi";

export default function DeploymentsPage() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("history");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState<string>("all"); // "all" | "multi" | "single"

  // Data
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [softwares, setSoftwares] = useState<SoftwareDefinition[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  // Trigger Modal
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [deployMode, setDeployMode] = useState<DeployMode>("single");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [selectedSoftwareId, setSelectedSoftwareId] = useState("");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [branchOverrides, setBranchOverrides] = useState<Record<string, string>>({});
  const [clientName, setClientName] = useState("");
  const [machineType, setMachineType] = useState("");
  const [multiClientFilter, setMultiClientFilter] = useState<string>("all");
  const [multiNodeSearch, setMultiNodeSearch] = useState<string>("");
  const [triggering, setTriggering] = useState(false);

  // Software Editor Modal
  const [softwareModalOpen, setSoftwareModalOpen] = useState(false);
  const [editingSoftwareId, setEditingSoftwareId] = useState<string | null>(null);
  const [softwareName, setSoftwareName] = useState("");
  const [softwareDesc, setSoftwareDesc] = useState("");
  const [components, setComponents] = useState<SoftwareComponent[]>([]);
  const [configRepo, setConfigRepo] = useState<SoftwareConfigRepo>({
    name: "Client Machine Configs",
    repo_url: "",
    default_branch: "main",
    target_dir: "/opt/nidoworkz/configs",
    profile_pattern: "configs/{client}/{machine_type}",
    import_to_mongo: true,
    mongo_database: "",
    import_script: "",
  });
  const [savingSoftware, setSavingSoftware] = useState(false);

  // Live Console Drawer / Modal
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [activeDeployment, setActiveDeployment] = useState<DeploymentRecord | null>(null);
  const [activeLogs, setActiveLogs] = useState<DeploymentLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  // Load initial data
  const loadData = async () => {
    try {
      setLoading(true);
      const [depsRes, softsRes, servsRes, sitesRes] = await Promise.all([
        apiFetch<DeploymentRecord[]>("/api/v1/deployments?limit=150"),
        apiFetch<SoftwareDefinition[]>("/api/v1/deployments/softwares"),
        apiFetch<Server[]>("/api/v1/servers"),
        apiFetch<Site[]>("/api/v1/sites").catch(() => []),
      ]);
      setDeployments(depsRes || []);
      setSoftwares(softsRes || []);
      setServers(servsRes || []);
      setSites(sitesRes || []);

      if (softsRes && softsRes.length > 0 && !selectedSoftwareId) {
        setSelectedSoftwareId(softsRes[0].id);
        setSelectedComponents(softsRes[0].components.map((c) => c.name));
      }
      if (servsRes && servsRes.length > 0) {
        if (!selectedServerId) setSelectedServerId(servsRes[0].id);
        if (selectedServerIds.length === 0) {
          // Pre-select online servers for multi-site
          const onlineIds = servsRes.filter((s) => s.status === "online").map((s) => s.id);
          setSelectedServerIds(onlineIds.length > 0 ? onlineIds : [servsRes[0].id]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load deployment data";
      showToast({ severity: "critical", title: "Load error", message: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin]);

  // Map server to site
  const serverSiteMap = useMemo(() => {
    const map = new Map<string, { client: string; location: string; code: string }>();
    const siteLookup = new Map<string, Site>();
    sites.forEach((s) => siteLookup.set(s.id, s));

    servers.forEach((srv) => {
      const site = siteLookup.get(srv.site_id);
      if (site) {
        map.set(srv.id, { client: site.client, location: site.location, code: site.code });
      } else {
        map.set(srv.id, { client: "Default", location: "Edge Node", code: "" });
      }
    });
    return map;
  }, [servers, sites]);

  // Unique clients for multi-site filter
  const uniqueClients = useMemo(() => {
    const set = new Set<string>();
    sites.forEach((s) => {
      if (s.client) set.add(s.client);
    });
    return Array.from(set).sort();
  }, [sites]);

  // Filtered servers in Multi-Site modal
  const multiFilteredServers = useMemo(() => {
    return servers.filter((srv) => {
      const info = serverSiteMap.get(srv.id);
      const clientMatch =
        multiClientFilter === "all" || (info && info.client.toLowerCase() === multiClientFilter.toLowerCase());
      const searchMatch =
        !multiNodeSearch ||
        srv.name.toLowerCase().includes(multiNodeSearch.toLowerCase()) ||
        srv.hostname.toLowerCase().includes(multiNodeSearch.toLowerCase()) ||
        (info && info.location.toLowerCase().includes(multiNodeSearch.toLowerCase())) ||
        (info && info.client.toLowerCase().includes(multiNodeSearch.toLowerCase()));
      return clientMatch && searchMatch;
    });
  }, [servers, serverSiteMap, multiClientFilter, multiNodeSearch]);

  // Socket.IO real-time subscriptions
  useEffect(() => {
    const socket = getSocket();

    const onDeploymentCreated = () => {
      apiFetch<DeploymentRecord[]>("/api/v1/deployments?limit=150")
        .then((res) => setDeployments(res || []))
        .catch(() => {});
    };

    const onDeploymentStatus = (data: { id: string; status: string }) => {
      setDeployments((prev) =>
        prev.map((d) =>
          d.id === data.id
            ? { ...d, status: data.status as DeploymentRecord["status"] }
            : d
        )
      );
      if (activeDeployment && activeDeployment.id === data.id) {
        setActiveDeployment((prev) =>
          prev ? { ...prev, status: data.status as DeploymentRecord["status"] } : prev
        );
      }
    };

    const onDeploymentLog = (data: {
      deployment_id: string;
      server_id: string;
      entry: DeploymentLogEntry;
    }) => {
      if (activeDeployment && activeDeployment.id === data.deployment_id) {
        setActiveLogs((prev) => [...prev, data.entry]);
      }
    };

    socket.on("deployment_created", onDeploymentCreated);
    socket.on("deployment_status", onDeploymentStatus);
    socket.on("deployment_log", onDeploymentLog);

    return () => {
      socket.off("deployment_created", onDeploymentCreated);
      socket.off("deployment_status", onDeploymentStatus);
      socket.off("deployment_log", onDeploymentLog);
    };
  }, [activeDeployment]);

  // Auto-scroll console
  useEffect(() => {
    if (autoScroll && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeLogs, autoScroll]);

  // When selected software changes in trigger modal, update default components
  useEffect(() => {
    const soft = softwares.find((s) => s.id === selectedSoftwareId);
    if (soft) {
      setSelectedComponents(soft.components.map((c) => c.name));
      const initBranches: Record<string, string> = {};
      soft.components.forEach((c) => {
        initBranches[c.name] = c.default_branch || "main";
      });
      if (soft.config_repo) {
        initBranches["configs"] = soft.config_repo.default_branch || "main";
      }
      setBranchOverrides(initBranches);
    }
  }, [selectedSoftwareId, softwares]);

  // Open live console for a deployment
  const openLiveConsole = async (deployment: DeploymentRecord) => {
    setActiveDeployment(deployment);
    setActiveLogs(deployment.logs || []);
    setConsoleOpen(true);
    try {
      const full = await apiFetch<DeploymentRecord>(`/api/v1/deployments/${deployment.id}`);
      if (full) {
        setActiveDeployment(full);
        setActiveLogs(full.logs || []);
      }
    } catch {
      // Retain state
    }
  };

  // Switch node tab inside Live Console Drawer (for multi-site batches)
  const switchBatchNode = async (dep: DeploymentRecord) => {
    setActiveDeployment(dep);
    setActiveLogs(dep.logs || []);
    try {
      const full = await apiFetch<DeploymentRecord>(`/api/v1/deployments/${dep.id}`);
      if (full) {
        setActiveDeployment(full);
        setActiveLogs(full.logs || []);
      }
    } catch {}
  };

  // Find sibling deployments in the same batch
  const batchSiblings = useMemo(() => {
    if (!activeDeployment || !activeDeployment.batch_id) return [];
    return deployments.filter((d) => d.batch_id === activeDeployment.batch_id);
  }, [activeDeployment, deployments]);

  // Trigger Deployment (Single Site or Multi-Site)
  const handleTriggerDeployment = async () => {
    if (!selectedSoftwareId) {
      showToast({ severity: "warning", title: "Required", message: "Select a software definition" });
      return;
    }

    if (deployMode === "single" && !selectedServerId) {
      showToast({ severity: "warning", title: "Required", message: "Select target site server" });
      return;
    }

    if (deployMode === "multi" && selectedServerIds.length === 0) {
      showToast({ severity: "warning", title: "Required", message: "Select at least one site server for deployment" });
      return;
    }

    setTriggering(true);
    try {
      const payload: any = {
        software_id: selectedSoftwareId,
        components_selected: selectedComponents,
        branches: branchOverrides,
        client_name: clientName,
        machine_type: machineType,
      };

      if (deployMode === "single") {
        payload.server_id = selectedServerId;
      } else {
        payload.server_ids = selectedServerIds;
      }

      const res = await apiFetch<any>("/api/v1/deployments/run", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (deployMode === "multi" && res.deployments) {
        showToast({
          severity: "info",
          title: "Multi-Site Deployment Started",
          message: `Queued across ${res.count || res.deployments.length} remote nodes simultaneously.`,
        });
        setDeployments((prev) => [...res.deployments, ...prev]);
        setTriggerModalOpen(false);
        if (res.deployments.length > 0) {
          openLiveConsole(res.deployments[0]);
        }
      } else {
        showToast({
          severity: "info",
          title: "Deployment Triggered",
          message: `Run #${res.id.slice(-6)} queued for execution.`,
        });
        setDeployments((prev) => [res, ...prev]);
        setTriggerModalOpen(false);
        openLiveConsole(res);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to trigger deployment";
      showToast({ severity: "critical", title: "Trigger failed", message: msg });
    } finally {
      setTriggering(false);
    }
  };

  // Cancel Deployment
  const handleCancelDeployment = async (depId: string) => {
    try {
      await apiFetch(`/api/v1/deployments/${depId}/cancel`, { method: "POST" });
      showToast({ severity: "info", title: "Cancelled", message: "Deployment marked as cancelled" });
      setDeployments((prev) =>
        prev.map((d) => (d.id === depId ? { ...d, status: "cancelled" } : d))
      );
      if (activeDeployment && activeDeployment.id === depId) {
        setActiveDeployment((prev) => (prev ? { ...prev, status: "cancelled" } : null));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel deployment";
      showToast({ severity: "critical", title: "Cancel error", message: msg });
    }
  };

  // Open Software Edit / Create Modal
  const handleOpenSoftwareModal = (soft?: SoftwareDefinition) => {
    if (soft) {
      setEditingSoftwareId(soft.id);
      setSoftwareName(soft.name);
      setSoftwareDesc(soft.description);
      setComponents(JSON.parse(JSON.stringify(soft.components || [])));
      setConfigRepo(
        soft.config_repo || {
          name: "Client Machine Configs",
          repo_url: "",
          default_branch: "main",
          target_dir: "/opt/nidoworkz/configs",
          profile_pattern: "configs/{client}/{machine_type}",
          import_to_mongo: true,
          mongo_database: "",
          import_script: "",
        }
      );
    } else {
      setEditingSoftwareId(null);
      setSoftwareName("");
      setSoftwareDesc("");
      setComponents([
        {
          name: "backend_monorepo",
          type: "nodejs_monorepo",
          repo_url: "git@github.com:nido/nidoworkz-backend.git",
          default_branch: "main",
          target_dir: "/opt/nidoworkz/backend",
          runtime_version: "24",
          build_command: "npm ci && npm run build",
          start_command: "pm2 startOrRestart ecosystem.config.js",
          env_vars: {},
        },
        {
          name: "frontend_php",
          type: "php_nginx",
          repo_url: "git@github.com:nido/nidoworkz-frontend.git",
          default_branch: "main",
          target_dir: "/var/www/nidoworkz",
          runtime_version: "8.4",
          build_command: "composer install --no-dev --optimize-autoloader",
          start_command: "systemctl reload nginx && systemctl restart php8.4-fpm",
          env_vars: {},
        },
      ]);
      setConfigRepo({
        name: "Client Machine Configs",
        repo_url: "git@github.com:nido/nidoworkz-configs.git",
        default_branch: "main",
        target_dir: "/opt/nidoworkz/configs",
        profile_pattern: "configs/{client}/{machine_type}",
        import_to_mongo: true,
        mongo_database: "nido_config",
        import_script: "python3 import_configs.py",
      });
    }
    setSoftwareModalOpen(true);
  };

  // Save Software Definition
  const handleSaveSoftware = async () => {
    if (!softwareName.trim()) {
      showToast({ severity: "warning", title: "Validation error", message: "Software name is required" });
      return;
    }
    setSavingSoftware(true);
    try {
      const payload = {
        name: softwareName.trim(),
        description: softwareDesc.trim(),
        components,
        config_repo: configRepo.repo_url.trim() ? configRepo : null,
      };

      if (editingSoftwareId) {
        const updated = await apiFetch<SoftwareDefinition>(
          `/api/v1/deployments/softwares/${editingSoftwareId}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          }
        );
        setSoftwares((prev) => prev.map((s) => (s.id === editingSoftwareId ? updated : s)));
        showToast({ severity: "info", title: "Saved", message: `"${updated.name}" updated successfully.` });
      } else {
        const created = await apiFetch<SoftwareDefinition>("/api/v1/deployments/softwares", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setSoftwares((prev) => [...prev, created]);
        showToast({ severity: "info", title: "Created", message: `"${created.name}" created successfully.` });
      }
      setSoftwareModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save software definition";
      showToast({ severity: "critical", title: "Save failed", message: msg });
    } finally {
      setSavingSoftware(false);
    }
  };

  // Delete Software
  const handleDeleteSoftware = async (softId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete software configuration "${name}"?`)) return;
    try {
      await apiFetch(`/api/v1/deployments/softwares/${softId}`, { method: "DELETE" });
      setSoftwares((prev) => prev.filter((s) => s.id !== softId));
      showToast({ severity: "info", title: "Deleted", message: `"${name}" was deleted.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete software";
      showToast({ severity: "critical", title: "Delete failed", message: msg });
    }
  };

  // Component manipulation in editor
  const handleAddComponent = () => {
    setComponents((prev) => [
      ...prev,
      {
        name: `component_${prev.length + 1}`,
        type: "nodejs_monorepo",
        repo_url: "",
        default_branch: "main",
        target_dir: `/opt/app/component_${prev.length + 1}`,
        runtime_version: "24",
        build_command: "npm ci && npm run build",
        start_command: "pm2 startOrRestart ecosystem.config.js",
        env_vars: {},
      },
    ]);
  };

  const handleUpdateComponent = (index: number, field: keyof SoftwareComponent, value: unknown) => {
    setComponents((prev) => {
      const clone = [...prev];
      clone[index] = { ...clone[index], [field]: value };
      return clone;
    });
  };

  const handleRemoveComponent = (index: number) => {
    setComponents((prev) => prev.filter((_, i) => i !== index));
  };

  // Toggle server in multi-site selection
  const toggleMultiServer = (serverId: string) => {
    setSelectedServerIds((prev) =>
      prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId]
    );
  };

  // Multi-site selection helpers
  const handleSelectAllFiltered = () => {
    const ids = multiFilteredServers.map((s) => s.id);
    setSelectedServerIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const handleSelectAllOnline = () => {
    const onlineIds = multiFilteredServers.filter((s) => s.status === "online").map((s) => s.id);
    setSelectedServerIds((prev) => Array.from(new Set([...prev, ...onlineIds])));
  };

  const handleDeselectAll = () => {
    const filteredIdSet = new Set(multiFilteredServers.map((s) => s.id));
    setSelectedServerIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
  };

  // Filtered deployments list
  const filteredDeployments = useMemo(() => {
    return deployments.filter((d) => {
      const matchesSearch =
        d.software_name.toLowerCase().includes(search.toLowerCase()) ||
        d.server_name.toLowerCase().includes(search.toLowerCase()) ||
        d.site_name.toLowerCase().includes(search.toLowerCase()) ||
        (d.client_name && d.client_name.toLowerCase().includes(search.toLowerCase())) ||
        (d.machine_type && d.machine_type.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus = statusFilter === "all" ? true : d.status === statusFilter;

      let matchesBatch = true;
      if (batchFilter === "multi") matchesBatch = Boolean(d.batch_id);
      else if (batchFilter === "single") matchesBatch = !d.batch_id;

      return matchesSearch && matchesStatus && matchesBatch;
    });
  }, [deployments, search, statusFilter, batchFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = deployments.length;
    const running = deployments.filter((d) => d.status === "running" || d.status === "pending").length;
    const success = deployments.filter((d) => d.status === "success").length;
    const failed = deployments.filter((d) => d.status === "failed").length;
    const multiCount = new Set(deployments.filter((d) => d.batch_id).map((d) => d.batch_id)).size;
    return { total, running, success, failed, multiCount };
  }, [deployments]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Software Deployments
            </h1>
            <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              Single & Multi-Site Orchestration
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Centrally dispatch and stream software deployments across single nodes or multi-site fleets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setDeployMode("single");
              setTriggerModalOpen(true);
            }}
            className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          >
            <Rocket className="h-4 w-4" />
            Deploy (Single Site)
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setDeployMode("multi");
              setTriggerModalOpen(true);
            }}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            <Globe2 className="h-4 w-4" />
            Multi-Site Deployment
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Runs</span>
              <Play className="h-4 w-4 text-blue-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">In Progress</span>
              <RefreshCw className={`h-4 w-4 text-amber-500 ${stats.running > 0 ? "animate-spin" : ""}`} />
            </div>
            <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.running}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Successful</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.success}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Multi-Site Batches</span>
              <Globe2 className="h-4 w-4 text-indigo-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.multiCount}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Softwares</span>
              <Layers className="h-4 w-4 text-purple-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-purple-600 dark:text-purple-400">{softwares.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Rocket className="h-4 w-4" />
          Deployment History & Activity
        </button>
        <button
          onClick={() => setActiveTab("softwares")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "softwares"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Code2 className="h-4 w-4" />
          Configured Softwares ({softwares.length})
        </button>
      </div>

      {/* Tab 1: Deployment History */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search software, server, site, client..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Batch Scope Filter */}
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg">
                <button
                  onClick={() => setBatchFilter("all")}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    batchFilter === "all"
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  All Runs
                </button>
                <button
                  onClick={() => setBatchFilter("multi")}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    batchFilter === "multi"
                      ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  <Globe2 className="h-3 w-3" />
                  Multi-Site Only
                </button>
                <button
                  onClick={() => setBatchFilter("single")}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    batchFilter === "single"
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  Single Site
                </button>
              </div>

              {/* Status Filter */}
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg">
                {["all", "running", "success", "failed"].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                      statusFilter === st
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Deployments List */}
          {filteredDeployments.length === 0 ? (
            <Card className="border-dashed border-slate-300 dark:border-slate-800">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Rocket className="h-10 w-10 text-slate-400 mb-3" />
                <p className="text-base font-medium text-slate-700 dark:text-slate-300">
                  No deployments found
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                  Trigger your first deployment to automate microservices, PM2 processes, and MongoDB config synchronization on remote servers.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setDeployMode("single");
                      setTriggerModalOpen(true);
                    }}
                    className="gap-1.5 bg-blue-600 text-white"
                  >
                    <Rocket className="h-4 w-4" />
                    Deploy Single Site
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDeployMode("multi");
                      setTriggerModalOpen(true);
                    }}
                    className="gap-1.5 bg-indigo-600 text-white"
                  >
                    <Globe2 className="h-4 w-4" />
                    Multi-Site Deployment
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredDeployments.map((d) => {
                const isRunning = d.status === "running" || d.status === "pending";
                return (
                  <div
                    key={d.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs transition-all hover:border-slate-300 dark:hover:border-slate-700"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            d.status === "success"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : d.status === "failed"
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                              : d.status === "running"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {d.status === "success" && <CheckCircle2 className="h-3 w-3" />}
                          {d.status === "failed" && <XCircle className="h-3 w-3" />}
                          {d.status === "running" && <RefreshCw className="h-3 w-3 animate-spin" />}
                          {d.status === "pending" && <Clock className="h-3 w-3" />}
                          {d.status.toUpperCase()}
                        </span>

                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          {d.software_name}
                        </h3>

                        {d.batch_id && (
                          <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-900/50 px-2 py-0.5 text-[11px] font-semibold">
                            <Globe2 className="h-3 w-3" />
                            Multi-Site Batch #{d.batch_id.slice(-6)}
                          </span>
                        )}

                        <span className="text-xs text-slate-400">#{d.id.slice(-6)}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                          <ServerIcon className="h-3.5 w-3.5 text-slate-400" />
                          {d.server_name} ({d.site_name})
                        </span>
                        {d.client_name && (
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                            Client: {d.client_name}
                          </span>
                        )}
                        {d.machine_type && (
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                            Machine: {d.machine_type}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {new Date(d.started_at).toLocaleString()}
                        </span>
                        {d.duration_seconds && (
                          <span>{d.duration_seconds.toFixed(1)}s elapsed</span>
                        )}
                        <span>by {d.triggered_by}</span>
                      </div>

                      {d.components_selected && d.components_selected.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-xs text-slate-400">Components:</span>
                          {d.components_selected.map((comp) => (
                            <span
                              key={comp}
                              className="rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-300"
                            >
                              {comp}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 sm:mt-0 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={isRunning ? "default" : "outline"}
                        onClick={() => openLiveConsole(d)}
                        className={`gap-1.5 text-xs ${
                          isRunning ? "bg-blue-600 text-white" : ""
                        }`}
                      >
                        <TerminalIcon className="h-3.5 w-3.5" />
                        {isRunning ? "Live Console" : "View Logs"}
                      </Button>

                      {isRunning && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCancelDeployment(d.id)}
                          className="gap-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 border-rose-200 dark:border-rose-900"
                        >
                          <StopCircle className="h-3.5 w-3.5" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Configured Softwares */}
      {activeTab === "softwares" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Registered applications and their component repository configurations.
            </p>
            <Button
              size="sm"
              onClick={() => handleOpenSoftwareModal()}
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="h-4 w-4" />
              New Software Definition
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {softwares.map((soft) => (
              <Card
                key={soft.id}
                className="border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-xs"
              >
                <CardHeader className="pb-3 flex flex-row items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {soft.name}
                      </CardTitle>
                      <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                        {soft.components.length} components
                      </span>
                    </div>
                    {soft.description && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {soft.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenSoftwareModal(soft)}
                      className="h-8 px-2 text-slate-600 hover:text-slate-900 dark:text-slate-300"
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteSoftware(soft.id, soft.name)}
                      className="h-8 px-2 text-rose-500 hover:text-rose-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  {/* Components */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Components
                    </span>
                    <div className="space-y-2">
                      {soft.components.map((comp) => (
                        <div
                          key={comp.name}
                          className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {comp.name}
                            </span>
                            <span className="rounded bg-slate-200/60 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                              {comp.type} {comp.runtime_version ? `(v${comp.runtime_version})` : ""}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-slate-500 truncate font-mono text-[11px]">
                            <GitBranch className="h-3 w-3 shrink-0" />
                            <span className="truncate">{comp.repo_url}</span>
                            <span className="text-blue-500">[{comp.default_branch}]</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Target: <span className="font-mono text-slate-600 dark:text-slate-300">{comp.target_dir}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Config Repo */}
                  {soft.config_repo && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        Client / Machine Config Repo
                      </span>
                      <div className="mt-1.5 p-2.5 rounded-lg border border-purple-100 dark:border-purple-950/40 bg-purple-50/30 dark:bg-purple-950/10 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-purple-900 dark:text-purple-300">
                            {soft.config_repo.name}
                          </span>
                          {soft.config_repo.import_to_mongo && (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                              MongoDB Seed
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-slate-500 font-mono text-[11px] truncate">
                          <GitBranch className="h-3 w-3 shrink-0" />
                          <span className="truncate">{soft.config_repo.repo_url}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Pattern: <code className="text-purple-700 dark:text-purple-400 font-mono">{soft.config_repo.profile_pattern}</code>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedSoftwareId(soft.id);
                        setDeployMode("single");
                        setTriggerModalOpen(true);
                      }}
                      className="flex-1 gap-1 text-xs bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800"
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      Deploy Single Site
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedSoftwareId(soft.id);
                        setDeployMode("multi");
                        setTriggerModalOpen(true);
                      }}
                      className="flex-1 gap-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      <Globe2 className="h-3.5 w-3.5" />
                      Multi-Site Deploy
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Trigger Deployment Modal (Single & Multi-Site) */}
      {triggerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 p-5">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    deployMode === "multi"
                      ? "bg-indigo-500/10 text-indigo-600"
                      : "bg-blue-500/10 text-blue-600"
                  }`}
                >
                  {deployMode === "multi" ? <Globe2 className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {deployMode === "multi" ? "Multi-Site Fleet Deployment" : "Single Site Deployment"}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {deployMode === "multi"
                      ? "Dispatch and orchestrate automated rollout across multiple site nodes."
                      : "Deploy to a specific target edge server node."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTriggerModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
              {/* Deployment Scope Toggle */}
              <div>
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Deployment Scope
                </Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeployMode("single")}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                      deployMode === "single"
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    <ServerIcon className="h-4 w-4" />
                    Single Site Deployment
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeployMode("multi")}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                      deployMode === "multi"
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/20"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    <Globe2 className="h-4 w-4" />
                    Multi-Site Fleet Deployment
                  </button>
                </div>
              </div>

              {/* Target Server Selection (Single Site Mode) */}
              {deployMode === "single" && (
                <div>
                  <Label className="font-semibold text-xs text-slate-700 dark:text-slate-300">
                    Target Site Server
                  </Label>
                  <select
                    value={selectedServerId}
                    onChange={(e) => setSelectedServerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Select target server...</option>
                    {servers.map((s) => {
                      const info = serverSiteMap.get(s.id);
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} ({info?.client} - {info?.location}) [{s.hostname}] - {s.status.toUpperCase()}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Target Servers Selection (Multi-Site Mode) */}
              {deployMode === "multi" && (
                <div className="space-y-2.5 rounded-xl border border-indigo-200/60 dark:border-indigo-900/40 bg-indigo-50/20 dark:bg-indigo-950/10 p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
                        Target Site Fleet ({selectedServerIds.length} Selected)
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Select all remote nodes that should execute this deployment concurrently.
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSelectAllFiltered}
                        className="h-7 px-2 text-[11px]"
                      >
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSelectAllOnline}
                        className="h-7 px-2 text-[11px] text-emerald-600 dark:text-emerald-400"
                      >
                        All Online
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDeselectAll}
                        className="h-7 px-2 text-[11px] text-slate-500"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>

                  {/* Filter bar inside multi-site */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                      <Input
                        placeholder="Filter sites or nodes..."
                        value={multiNodeSearch}
                        onChange={(e) => setMultiNodeSearch(e.target.value)}
                        className="h-8 pl-8 text-xs bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <select
                        value={multiClientFilter}
                        onChange={(e) => setMultiClientFilter(e.target.value)}
                        className="h-8 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                      >
                        <option value="all">All Clients ({uniqueClients.length})</option>
                        {uniqueClients.map((client) => (
                          <option key={client} value={client}>
                            Client: {client}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Checkbox List of Site Servers */}
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {multiFilteredServers.length === 0 ? (
                      <p className="text-center text-xs text-slate-400 py-3">No matching site servers</p>
                    ) : (
                      multiFilteredServers.map((srv) => {
                        const isSelected = selectedServerIds.includes(srv.id);
                        const info = serverSiteMap.get(srv.id);
                        const isOnline = srv.status === "online";
                        return (
                          <div
                            key={srv.id}
                            onClick={() => toggleMultiServer(srv.id)}
                            className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                              isSelected
                                ? "border-indigo-500 bg-indigo-500/10 dark:bg-indigo-950/30 font-medium"
                                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {isSelected ? (
                                <CheckSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                              ) : (
                                <Square className="h-4 w-4 text-slate-400 shrink-0" />
                              )}
                              <div>
                                <span className="text-slate-900 dark:text-slate-100 font-medium">
                                  {srv.name}
                                </span>
                                <span className="ml-1.5 text-slate-400 text-[11px]">
                                  ({info?.client} - {info?.location})
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-[11px] text-slate-500">
                                {srv.hostname}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase ${
                                  isOnline
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-rose-500/10 text-rose-600"
                                }`}
                              >
                                {srv.status}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Software Definition Selection */}
              <div>
                <Label className="font-semibold text-xs text-slate-700 dark:text-slate-300">
                  Software Stack
                </Label>
                <select
                  value={selectedSoftwareId}
                  onChange={(e) => setSelectedSoftwareId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  {softwares.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.components.length} components)
                    </option>
                  ))}
                </select>
              </div>

              {/* Deploy Components Checkboxes */}
              {softwares.find((s) => s.id === selectedSoftwareId) && (
                <div>
                  <Label className="font-semibold text-xs text-slate-700 dark:text-slate-300">
                    Deploy Components
                  </Label>
                  <div className="mt-1.5 space-y-2">
                    {softwares
                      .find((s) => s.id === selectedSoftwareId)!
                      .components.map((c) => {
                        const isChecked = selectedComponents.includes(c.name);
                        return (
                          <div
                            key={c.name}
                            className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 bg-slate-50/50 dark:bg-slate-800/40"
                          >
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedComponents((prev) => [...prev, c.name]);
                                  } else {
                                    setSelectedComponents((prev) =>
                                      prev.filter((item) => item !== c.name)
                                    );
                                  }
                                }}
                                className="rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span className="font-medium text-slate-900 dark:text-slate-100 text-xs">
                                {c.name} ({c.type})
                              </span>
                            </label>

                            <div className="flex items-center gap-1.5">
                              <GitBranch className="h-3.5 w-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="branch"
                                value={branchOverrides[c.name] || c.default_branch}
                                onChange={(e) =>
                                  setBranchOverrides({
                                    ...branchOverrides,
                                    [c.name]: e.target.value,
                                  })
                                }
                                className="w-24 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-xs font-mono"
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Machine Type Profile */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Client Name Override (Optional)
                  </Label>
                  <Input
                    placeholder="Auto-resolved from site if blank"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="mt-1 text-xs"
                  />
                  <p className="mt-0.5 text-[10px] text-slate-400">Default: Each site's registered client name</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Machine Type (Optional)
                  </Label>
                  <Input
                    placeholder="e.g. sorter_v3 or ipc_neo5"
                    value={machineType}
                    onChange={(e) => setMachineType(e.target.value)}
                    className="mt-1 text-xs"
                  />
                  <p className="mt-0.5 text-[10px] text-slate-400">Target hardware profile in config repo</p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 p-4">
              <div className="text-xs text-slate-500">
                {deployMode === "multi" ? (
                  <span>
                    Rollout to <strong>{selectedServerIds.length}</strong> site server(s) simultaneously
                  </span>
                ) : (
                  <span>Single site deployment</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTriggerModalOpen(false)}
                  disabled={triggering}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleTriggerDeployment}
                  disabled={
                    triggering ||
                    (deployMode === "single" && !selectedServerId) ||
                    (deployMode === "multi" && selectedServerIds.length === 0) ||
                    selectedComponents.length === 0
                  }
                  className={`gap-1.5 text-white ${
                    deployMode === "multi"
                      ? "bg-indigo-600 hover:bg-indigo-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {triggering ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Dispatching...
                    </>
                  ) : deployMode === "multi" ? (
                    <>
                      <Globe2 className="h-4 w-4" />
                      Start Fleet Rollout ({selectedServerIds.length} Sites)
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Start Deployment
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Software Definition Modal (Add/Edit) */}
      {softwareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 p-5">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {editingSoftwareId ? "Edit Software Definition" : "New Software Definition"}
                </h2>
              </div>
              <button
                onClick={() => setSoftwareModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold">Software Name *</Label>
                  <Input
                    placeholder="e.g. nidoworkz"
                    value={softwareName}
                    onChange={(e) => setSoftwareName(e.target.value)}
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Description</Label>
                  <Input
                    placeholder="e.g. Core warehouse management system"
                    value={softwareDesc}
                    onChange={(e) => setSoftwareDesc(e.target.value)}
                    className="mt-1 text-sm"
                  />
                </div>
              </div>

              {/* Multi-Component Setup */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Application Components ({components.length})
                  </Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddComponent}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Component
                  </Button>
                </div>

                <div className="space-y-3">
                  {components.map((comp, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                          Component #{idx + 1}
                        </span>
                        {components.length > 1 && (
                          <button
                            onClick={() => handleRemoveComponent(idx)}
                            className="text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[11px]">Name</Label>
                          <Input
                            value={comp.name}
                            onChange={(e) => handleUpdateComponent(idx, "name", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Type</Label>
                          <select
                            value={comp.type}
                            onChange={(e) => handleUpdateComponent(idx, "type", e.target.value)}
                            className="h-8 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                          >
                            <option value="nodejs_monorepo">Node.js Monorepo (PM2)</option>
                            <option value="php_nginx">PHP (Nginx + FPM)</option>
                            <option value="custom_script">Custom Bash / Script</option>
                            <option value="docker">Docker Compose</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Runtime Version</Label>
                          <Input
                            placeholder="e.g. 24 or 8.4"
                            value={comp.runtime_version || ""}
                            onChange={(e) =>
                              handleUpdateComponent(idx, "runtime_version", e.target.value)
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <Label className="text-[11px]">Git Repository URL</Label>
                          <Input
                            placeholder="git@github.com:org/repo.git or https://..."
                            value={comp.repo_url}
                            onChange={(e) => handleUpdateComponent(idx, "repo_url", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Default Branch</Label>
                          <Input
                            value={comp.default_branch}
                            onChange={(e) =>
                              handleUpdateComponent(idx, "default_branch", e.target.value)
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[11px]">Target Directory</Label>
                          <Input
                            placeholder="/opt/myapp/backend"
                            value={comp.target_dir}
                            onChange={(e) =>
                              handleUpdateComponent(idx, "target_dir", e.target.value)
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Build Command</Label>
                          <Input
                            placeholder="npm ci && npm run build"
                            value={comp.build_command || ""}
                            onChange={(e) =>
                              handleUpdateComponent(idx, "build_command", e.target.value)
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Start / Reload Command</Label>
                          <Input
                            placeholder="pm2 startOrRestart ecosystem.config.js"
                            value={comp.start_command || ""}
                            onChange={(e) =>
                              handleUpdateComponent(idx, "start_command", e.target.value)
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Config Repository Configuration */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <Label className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">
                  Client & Machine Config Repository (Optional)
                </Label>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label className="text-[11px]">Config Repo URL</Label>
                    <Input
                      placeholder="git@github.com:org/nidoworkz-configs.git"
                      value={configRepo.repo_url}
                      onChange={(e) => setConfigRepo({ ...configRepo, repo_url: e.target.value })}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Branch</Label>
                    <Input
                      value={configRepo.default_branch}
                      onChange={(e) =>
                        setConfigRepo({ ...configRepo, default_branch: e.target.value })
                      }
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Directory Pattern</Label>
                    <Input
                      placeholder="configs/{client}/{machine_type}"
                      value={configRepo.profile_pattern}
                      onChange={(e) =>
                        setConfigRepo({ ...configRepo, profile_pattern: e.target.value })
                      }
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Local MongoDB DB Name</Label>
                    <Input
                      placeholder="e.g. nido_config"
                      value={configRepo.mongo_database || ""}
                      onChange={(e) =>
                        setConfigRepo({ ...configRepo, mongo_database: e.target.value })
                      }
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 p-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSoftwareModalOpen(false)}
                disabled={savingSoftware}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveSoftware}
                disabled={savingSoftware}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {savingSoftware ? "Saving..." : "Save Software Definition"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live Console Drawer / Modal */}
      {consoleOpen && activeDeployment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-xs">
          <div className="w-full max-w-5xl h-[88vh] flex flex-col rounded-2xl border border-slate-800 bg-zinc-950 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            {/* Terminal Top Bar */}
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                </div>
                <div className="flex items-center gap-2">
                  <TerminalIcon className="h-4 w-4 text-slate-400" />
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    Deployment #{activeDeployment.id.slice(-6)} - {activeDeployment.software_name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      activeDeployment.status === "success"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : activeDeployment.status === "failed"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-blue-500/20 text-blue-400 animate-pulse"
                    }`}
                  >
                    {activeDeployment.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`rounded px-2 py-1 text-[11px] font-mono transition-colors ${
                    autoScroll
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Auto-Scroll: {autoScroll ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => {
                    const text = activeLogs.map((l) => `[${l.stage}] ${l.line}`).join("\n");
                    navigator.clipboard.writeText(text);
                    showToast({ severity: "info", title: "Copied", message: "Logs copied to clipboard" });
                  }}
                  className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-mono text-zinc-300 hover:bg-zinc-700"
                >
                  <Copy className="h-3 w-3 inline mr-1" />
                  Copy
                </button>
                <button
                  onClick={() => setConsoleOpen(false)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Multi-Site Node Switcher Tab Bar (if part of a batch) */}
            {batchSiblings.length > 1 && (
              <div className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1 mr-2 shrink-0">
                  <Globe2 className="h-3.5 w-3.5 text-indigo-400" />
                  Fleet Nodes:
                </span>
                {batchSiblings.map((sib) => {
                  const isCurrent = sib.id === activeDeployment.id;
                  return (
                    <button
                      key={sib.id}
                      onClick={() => switchBatchNode(sib)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono shrink-0 transition-colors ${
                        isCurrent
                          ? "bg-indigo-600 text-white font-semibold shadow-xs"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      <span>{sib.server_name}</span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          sib.status === "success"
                            ? "bg-emerald-400"
                            : sib.status === "failed"
                            ? "bg-rose-400"
                            : "bg-blue-400 animate-ping"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Target Node Metadata */}
            <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/30 px-4 py-2 text-xs font-mono text-zinc-400">
              <div className="flex items-center gap-4">
                <span>Node: <strong className="text-zinc-200">{activeDeployment.server_name}</strong></span>
                <span>Site: <strong className="text-zinc-200">{activeDeployment.site_name}</strong></span>
                {activeDeployment.client_name && (
                  <span>Client: <strong className="text-zinc-200">{activeDeployment.client_name}</strong></span>
                )}
                {activeDeployment.machine_type && (
                  <span>Machine: <strong className="text-zinc-200">{activeDeployment.machine_type}</strong></span>
                )}
              </div>
              <div>
                Started: {new Date(activeDeployment.started_at).toLocaleTimeString()}
              </div>
            </div>

            {/* Terminal Body */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-zinc-300 space-y-1 select-text">
              {activeLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Waiting for agent output stream...</span>
                </div>
              ) : (
                activeLogs.map((log, i) => {
                  let colorClass = "text-zinc-300";
                  if (log.level === "error") colorClass = "text-rose-400 font-semibold";
                  else if (log.level === "warn") colorClass = "text-amber-400";
                  else if (log.level === "success") colorClass = "text-emerald-400 font-semibold";
                  else if (log.stage.includes("done") || log.stage.includes("complete"))
                    colorClass = "text-cyan-400";

                  return (
                    <div key={i} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-zinc-600 shrink-0 select-none text-[10px]">
                        {new Date(log.ts).toLocaleTimeString()}
                      </span>
                      <span className="rounded bg-zinc-800/70 px-1 py-0.5 text-[10px] text-zinc-400 shrink-0 select-none">
                        {log.stage}
                      </span>
                      <span className={`break-all ${colorClass}`}>{log.line}</span>
                    </div>
                  );
                })
              )}
              <div ref={consoleBottomRef} />
            </div>

            {/* Terminal Footer */}
            <div className="border-t border-zinc-800 bg-zinc-900/60 px-4 py-2 flex items-center justify-between text-xs text-zinc-400">
              <span className="font-mono text-[11px]">
                {activeLogs.length} stream lines received
              </span>
              {activeDeployment.status === "running" && (
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                  <span className="text-blue-400 font-mono text-[11px]">Agent executing on {activeDeployment.server_name}...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
