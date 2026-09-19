import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Cpu,
  Database,
  Layers,
  Pencil,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { showToast } from "@/components/ToastHost";
import type { AgentRuntimeTemplate, ConnectivityTarget, WidgetTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TabType = "runtime" | "widget";

const DEFAULT_RUNTIME_FORM = {
  name: "",
  description: "",
  monitoring_interval_seconds: 60,
  http_timeout_seconds: 10,
  http_retry_count: 3,
  config_poll_interval_seconds: 5,
  connectivity_poll_interval_seconds: 15,
  connectivity_targets: [] as ConnectivityTarget[],
};

const DEFAULT_WIDGET_FORM = {
  name: "",
  description: "",
  database: "",
  collection: "",
  enabled: true,
  poll_interval_seconds: 60,
  window_minutes: 60,
  group_by_field: "upload_status",
  time_field: "created_at",
  max_groups: 10,
  alert_threshold_percent: 50.0,
  alert_window_minutes: 15,
};

export default function TemplatesPage() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("runtime");
  const [search, setSearch] = useState("");

  const [runtimeTemplates, setRuntimeTemplates] = useState<AgentRuntimeTemplate[]>([]);
  const [widgetTemplates, setWidgetTemplates] = useState<WidgetTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Runtime Modal state
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [editingRuntimeId, setEditingRuntimeId] = useState<string | null>(null);
  const [runtimeForm, setRuntimeForm] = useState(DEFAULT_RUNTIME_FORM);
  const [newTargetName, setNewTargetName] = useState("");
  const [newTargetIp, setNewTargetIp] = useState("");
  const [savingRuntime, setSavingRuntime] = useState(false);

  // Widget Modal state
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [widgetForm, setWidgetForm] = useState(DEFAULT_WIDGET_FORM);
  const [savingWidget, setSavingWidget] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      loadAllTemplates();
    }
  }, [isAdmin]);

  async function loadAllTemplates() {
    setLoading(true);
    try {
      const [runtimes, widgets] = await Promise.all([
        apiFetch<AgentRuntimeTemplate[]>("/agent-config-templates").catch(() => []),
        apiFetch<WidgetTemplate[]>("/widgets/templates").catch(() => []),
      ]);
      setRuntimeTemplates(runtimes);
      setWidgetTemplates(widgets);
    } catch {
      showToast({ severity: "critical", title: "Load error", message: "Failed to load templates." });
    } finally {
      setLoading(false);
    }
  }

  // Filtered lists
  const filteredRuntimes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return runtimeTemplates;
    return runtimeTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.connectivity_targets.some((ct) => ct.name.toLowerCase().includes(q) || ct.ip.toLowerCase().includes(q))
    );
  }, [runtimeTemplates, search]);

  const filteredWidgets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return widgetTemplates;
    return widgetTemplates.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.database.toLowerCase().includes(q) ||
        w.collection.toLowerCase().includes(q) ||
        w.group_by_field.toLowerCase().includes(q)
    );
  }, [widgetTemplates, search]);

  // ===================== Runtime Template Handlers =====================

  function openCreateRuntime() {
    setEditingRuntimeId(null);
    setRuntimeForm(DEFAULT_RUNTIME_FORM);
    setNewTargetName("");
    setNewTargetIp("");
    setRuntimeModalOpen(true);
  }

  function openEditRuntime(t: AgentRuntimeTemplate) {
    setEditingRuntimeId(t.id);
    setRuntimeForm({
      name: t.name,
      description: t.description || "",
      monitoring_interval_seconds: t.monitoring_interval_seconds,
      http_timeout_seconds: t.http_timeout_seconds,
      http_retry_count: t.http_retry_count,
      config_poll_interval_seconds: t.config_poll_interval_seconds,
      connectivity_poll_interval_seconds: t.connectivity_poll_interval_seconds,
      connectivity_targets: t.connectivity_targets || [],
    });
    setNewTargetName("");
    setNewTargetIp("");
    setRuntimeModalOpen(true);
  }

  function duplicateRuntime(t: AgentRuntimeTemplate) {
    setEditingRuntimeId(null);
    setRuntimeForm({
      name: `${t.name} (Copy)`,
      description: t.description || "",
      monitoring_interval_seconds: t.monitoring_interval_seconds,
      http_timeout_seconds: t.http_timeout_seconds,
      http_retry_count: t.http_retry_count,
      config_poll_interval_seconds: t.config_poll_interval_seconds,
      connectivity_poll_interval_seconds: t.connectivity_poll_interval_seconds,
      connectivity_targets: [...(t.connectivity_targets || [])],
    });
    setNewTargetName("");
    setNewTargetIp("");
    setRuntimeModalOpen(true);
  }

  async function saveRuntime() {
    if (!runtimeForm.name.trim()) {
      showToast({ severity: "critical", title: "Validation error", message: "Template name is required." });
      return;
    }
    setSavingRuntime(true);
    try {
      if (editingRuntimeId) {
        const updated = await apiFetch<AgentRuntimeTemplate>(`/agent-config-templates/${editingRuntimeId}`, {
          method: "PUT",
          body: JSON.stringify(runtimeForm),
        });
        setRuntimeTemplates((prev) => prev.map((t) => (t.id === editingRuntimeId ? updated : t)));
        showToast({ severity: "info", title: "Template updated", message: `"${updated.name}" saved.` });
      } else {
        const created = await apiFetch<AgentRuntimeTemplate>("/agent-config-templates", {
          method: "POST",
          body: JSON.stringify(runtimeForm),
        });
        setRuntimeTemplates((prev) => {
          const idx = prev.findIndex((t) => t.id === created.id || t.name === created.name);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = created;
            return next;
          }
          return [...prev, created];
        });
        showToast({ severity: "info", title: "Template created", message: `"${created.name}" created.` });
      }
      setRuntimeModalOpen(false);
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Save failed",
        message: err instanceof Error ? err.message : "Could not save runtime template.",
      });
    } finally {
      setSavingRuntime(false);
    }
  }

  async function deleteRuntime(t: AgentRuntimeTemplate) {
    if (!confirm(`Are you sure you want to delete runtime template "${t.name}"? Servers currently using these settings are unaffected.`)) {
      return;
    }
    try {
      await apiFetch(`/agent-config-templates/${t.id}`, { method: "DELETE" });
      setRuntimeTemplates((prev) => prev.filter((item) => item.id !== t.id));
      showToast({ severity: "info", title: "Template deleted", message: `"${t.name}" was removed.` });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Could not delete template.",
      });
    }
  }

  function addTargetToRuntime() {
    const name = newTargetName.trim();
    const ip = newTargetIp.trim();
    if (!name || !ip) {
      showToast({ severity: "warning", title: "Missing fields", message: "Provide both device name and IP address." });
      return;
    }
    setRuntimeForm((prev) => ({
      ...prev,
      connectivity_targets: [...prev.connectivity_targets, { name, ip }],
    }));
    setNewTargetName("");
    setNewTargetIp("");
  }

  function removeTargetFromRuntime(index: number) {
    setRuntimeForm((prev) => ({
      ...prev,
      connectivity_targets: prev.connectivity_targets.filter((_, i) => i !== index),
    }));
  }

  // ===================== Widget Template Handlers =====================

  function openCreateWidget() {
    setEditingWidgetId(null);
    setWidgetForm(DEFAULT_WIDGET_FORM);
    setWidgetModalOpen(true);
  }

  function openEditWidget(w: WidgetTemplate) {
    setEditingWidgetId(w.id);
    setWidgetForm({
      name: w.name,
      description: w.description || "",
      database: w.database,
      collection: w.collection,
      enabled: w.enabled,
      poll_interval_seconds: w.poll_interval_seconds,
      window_minutes: w.window_minutes,
      group_by_field: w.group_by_field,
      time_field: w.time_field,
      max_groups: w.max_groups,
      alert_threshold_percent: w.alert_threshold_percent ?? 50.0,
      alert_window_minutes: w.alert_window_minutes ?? 15,
    });
    setWidgetModalOpen(true);
  }

  function duplicateWidget(w: WidgetTemplate) {
    setEditingWidgetId(null);
    setWidgetForm({
      name: `${w.name} (Copy)`,
      description: w.description || "",
      database: w.database,
      collection: w.collection,
      enabled: w.enabled,
      poll_interval_seconds: w.poll_interval_seconds,
      window_minutes: w.window_minutes,
      group_by_field: w.group_by_field,
      time_field: w.time_field,
      max_groups: w.max_groups,
      alert_threshold_percent: w.alert_threshold_percent ?? 50.0,
      alert_window_minutes: w.alert_window_minutes ?? 15,
    });
    setWidgetModalOpen(true);
  }

  async function saveWidget() {
    if (!widgetForm.name.trim() || !widgetForm.database.trim() || !widgetForm.collection.trim()) {
      showToast({
        severity: "critical",
        title: "Validation error",
        message: "Widget name, database, and collection are required.",
      });
      return;
    }
    setSavingWidget(true);
    try {
      if (editingWidgetId) {
        const updated = await apiFetch<WidgetTemplate>(`/widgets/templates/${editingWidgetId}`, {
          method: "PUT",
          body: JSON.stringify(widgetForm),
        });
        setWidgetTemplates((prev) => prev.map((w) => (w.id === editingWidgetId ? updated : w)));
        showToast({ severity: "info", title: "Template updated", message: `"${updated.name}" saved.` });
      } else {
        const created = await apiFetch<WidgetTemplate>("/widgets/templates", {
          method: "POST",
          body: JSON.stringify(widgetForm),
        });
        setWidgetTemplates((prev) => {
          const idx = prev.findIndex((w) => w.id === created.id || w.name === created.name);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = created;
            return next;
          }
          return [...prev, created];
        });
        showToast({ severity: "info", title: "Template created", message: `"${created.name}" created.` });
      }
      setWidgetModalOpen(false);
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Save failed",
        message: err instanceof Error ? err.message : "Could not save widget template.",
      });
    } finally {
      setSavingWidget(false);
    }
  }

  async function deleteWidget(w: WidgetTemplate) {
    if (!confirm(`Are you sure you want to delete widget template "${w.name}"? Servers currently using this widget are unaffected.`)) {
      return;
    }
    try {
      await apiFetch(`/widgets/templates/${w.id}`, { method: "DELETE" });
      setWidgetTemplates((prev) => prev.filter((item) => item.id !== w.id));
      showToast({ severity: "info", title: "Template deleted", message: `"${w.name}" was removed.` });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Could not delete template.",
      });
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <h2 className="text-xl font-bold text-red-400">Access Restricted</h2>
        <p className="mt-1 text-sm text-slate-400">Template management is restricted to Admin and Super Admin accounts.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <Layers className="h-6 w-6 text-indigo-400" />
            Template Library
          </h1>
          <p className="text-sm text-slate-400">
            Define reusable runtime settings and custom MongoDB data widgets to apply across any client site.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === "runtime" ? (
            <Button
              onClick={openCreateRuntime}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-500/20"
              size="sm"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New Runtime Template
            </Button>
          ) : (
            <Button
              onClick={openCreateWidget}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-500/20"
              size="sm"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New Widget Template
            </Button>
          )}
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-xl bg-slate-900/80 p-1 border border-slate-800">
          <button
            onClick={() => setActiveTab("runtime")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "runtime"
                ? "bg-indigo-600/90 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Agent Runtime Templates
            <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${
              activeTab === "runtime" ? "bg-indigo-400/25 text-white" : "bg-slate-800 text-slate-400"
            }`}>
              {runtimeTemplates.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("widget")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "widget"
                ? "bg-emerald-600/90 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            Custom Widget Templates
            <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${
              activeTab === "widget" ? "bg-emerald-400/25 text-white" : "bg-slate-800 text-slate-400"
            }`}>
              {widgetTemplates.length}
            </span>
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs bg-slate-900/90 border-slate-800 text-slate-200 placeholder:text-slate-500 rounded-lg"
          />
        </div>
      </div>

      {/* Content Section */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-xl border border-slate-800/60 bg-slate-900/40 animate-pulse" />
          ))}
        </div>
      ) : activeTab === "runtime" ? (
        filteredRuntimes.length === 0 ? (
          <Card className="border-slate-800 bg-slate-900/40 py-12 text-center">
            <CardContent className="flex flex-col items-center justify-center">
              <SlidersHorizontal className="h-10 w-10 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No runtime templates found</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Runtime templates allow you to define monitoring push intervals, HTTP timeouts, and device ping lists once, then apply them to any site server.
              </p>
              <Button onClick={openCreateRuntime} size="sm" variant="outline" className="mt-4 border-slate-700">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create your first template
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRuntimes.map((t) => (
              <Card
                key={t.id}
                className="group relative flex flex-col justify-between border-slate-800/80 bg-slate-900/70 hover:border-indigo-500/40 transition-all shadow-md hover:shadow-indigo-500/5"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400 border border-indigo-500/20">
                        <Cpu className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-slate-100">{t.name}</CardTitle>
                        {t.description && (
                          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{t.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 pt-0 text-xs">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-2.5">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Push Interval</span>
                      <span className="font-semibold text-slate-200">{t.monitoring_interval_seconds}s</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Config Poller</span>
                      <span className="font-semibold text-slate-200">{t.config_poll_interval_seconds}s</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Ping Interval</span>
                      <span className="font-semibold text-slate-200">{t.connectivity_poll_interval_seconds}s</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">HTTP Timeout</span>
                      <span className="font-semibold text-slate-200">{t.http_timeout_seconds}s ({t.http_retry_count} retries)</span>
                    </div>
                  </div>

                  {/* Targets preview */}
                  <div>
                    <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5 mb-1.5">
                      <Radio className="h-3 w-3 text-sky-400" />
                      Ping Devices ({t.connectivity_targets?.length || 0})
                    </span>
                    {t.connectivity_targets?.length ? (
                      <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                        {t.connectivity_targets.map((ct, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-300 border border-slate-700/50"
                          >
                            <span className="font-semibold text-sky-300">{ct.name}:</span>
                            <span className="font-mono text-slate-400">{ct.ip}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">No ping targets configured</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-1">
                    <span className="text-[10px] text-slate-500">
                      Updated {new Date(t.updated_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => duplicateRuntime(t)}
                        title="Duplicate this template"
                        className="h-7 px-2 text-slate-400 hover:text-indigo-300 hover:bg-slate-800"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditRuntime(t)}
                        title="Edit template"
                        className="h-7 px-2 text-slate-400 hover:text-sky-300 hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void deleteRuntime(t)}
                        title="Delete template"
                        className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-slate-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        /* Widget Templates Tab */
        filteredWidgets.length === 0 ? (
          <Card className="border-slate-800 bg-slate-900/40 py-12 text-center">
            <CardContent className="flex flex-col items-center justify-center">
              <Database className="h-10 w-10 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No widget templates found</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Widget templates define periodic count queries on site MongoDB collections (e.g. integration logs breakdown, telemetry tallies) to add to any server with 1 click.
              </p>
              <Button onClick={openCreateWidget} size="sm" variant="outline" className="mt-4 border-slate-700">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create your first widget template
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWidgets.map((w) => (
              <Card
                key={w.id}
                className="group relative flex flex-col justify-between border-slate-800/80 bg-slate-900/70 hover:border-emerald-500/40 transition-all shadow-md hover:shadow-emerald-500/5"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
                        <Database className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-slate-100">{w.name}</CardTitle>
                        {w.description && (
                          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{w.description}</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                        w.enabled
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      {w.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 pt-0 text-xs">
                  {/* Database & Collection target */}
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-2.5 font-mono">
                    <span className="text-[10px] text-slate-500 block uppercase font-sans">Target Collection</span>
                    <span className="text-emerald-400 font-semibold">{w.database}</span>
                    <span className="text-slate-500">.</span>
                    <span className="text-slate-200">{w.collection}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-2.5">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Group By</span>
                      <span className="font-mono text-slate-300 truncate block">{w.group_by_field}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Time Field</span>
                      <span className="font-mono text-slate-300 truncate block">{w.time_field}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Poll Interval</span>
                      <span className="font-semibold text-slate-200">{w.poll_interval_seconds}s</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Window</span>
                      <span className="font-semibold text-slate-200">{w.window_minutes}m</span>
                    </div>
                  </div>

                  {/* Failure Alert settings */}
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-slate-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Failure Threshold:
                    </span>
                    <span className="font-semibold text-amber-300">
                      {w.alert_threshold_percent ?? 50}% <span className="text-[10px] text-slate-400 font-normal">({w.alert_window_minutes ?? 15}m window)</span>
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-1">
                    <span className="text-[10px] text-slate-500">
                      Updated {new Date(w.updated_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => duplicateWidget(w)}
                        title="Duplicate this template"
                        className="h-7 px-2 text-slate-400 hover:text-emerald-300 hover:bg-slate-800"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditWidget(w)}
                        title="Edit template"
                        className="h-7 px-2 text-slate-400 hover:text-sky-300 hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void deleteWidget(w)}
                        title="Delete template"
                        className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-slate-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {/* ===================== Runtime Template Modal ===================== */}
      {runtimeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
                {editingRuntimeId ? "Edit Runtime Template" : "New Runtime Template"}
              </h2>
              <button
                onClick={() => setRuntimeModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4 py-4 text-xs">
              <div className="grid grid-cols-1 gap-1.5">
                <Label className="text-xs text-slate-300">Template Name *</Label>
                <Input
                  type="text"
                  placeholder="e.g. High Frequency Production"
                  value={runtimeForm.name}
                  onChange={(e) => setRuntimeForm({ ...runtimeForm, name: e.target.value })}
                  className="h-8 text-xs bg-slate-950 border-slate-700"
                />
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                <Label className="text-xs text-slate-300">Description</Label>
                <Input
                  type="text"
                  placeholder="e.g. Optimized for primary sorting lines with 10s pushes"
                  value={runtimeForm.description}
                  onChange={(e) => setRuntimeForm({ ...runtimeForm, description: e.target.value })}
                  className="h-8 text-xs bg-slate-950 border-slate-700"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">Monitoring Interval (s)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={runtimeForm.monitoring_interval_seconds}
                    onChange={(e) => setRuntimeForm({ ...runtimeForm, monitoring_interval_seconds: parseInt(e.target.value) || 60 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">Config Poller (s)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={runtimeForm.config_poll_interval_seconds}
                    onChange={(e) => setRuntimeForm({ ...runtimeForm, config_poll_interval_seconds: parseInt(e.target.value) || 5 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">Ping Interval (s)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={runtimeForm.connectivity_poll_interval_seconds}
                    onChange={(e) => setRuntimeForm({ ...runtimeForm, connectivity_poll_interval_seconds: parseInt(e.target.value) || 15 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">HTTP Timeout (s)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={runtimeForm.http_timeout_seconds}
                    onChange={(e) => setRuntimeForm({ ...runtimeForm, http_timeout_seconds: parseInt(e.target.value) || 10 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">HTTP Retry Count</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={runtimeForm.http_retry_count}
                    onChange={(e) => setRuntimeForm({ ...runtimeForm, http_retry_count: parseInt(e.target.value) || 3 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
              </div>

              {/* Connectivity Targets List */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                <Label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Realtime Ping Targets ({runtimeForm.connectivity_targets.length})</span>
                  <span className="text-[11px] font-normal text-slate-500">e.g. PLC, Printer, Scanner</span>
                </Label>

                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Device Name (e.g. Weighscale PLC)"
                    value={newTargetName}
                    onChange={(e) => setNewTargetName(e.target.value)}
                    className="h-8 text-xs bg-slate-950 border-slate-700 w-1/2"
                  />
                  <Input
                    type="text"
                    placeholder="IP / Host (e.g. 192.168.1.50)"
                    value={newTargetIp}
                    onChange={(e) => setNewTargetIp(e.target.value)}
                    className="h-8 text-xs bg-slate-950 border-slate-700 w-1/2"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={addTargetToRuntime}
                    className="h-8 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 shrink-0"
                  >
                    Add
                  </Button>
                </div>

                {runtimeForm.connectivity_targets.length > 0 ? (
                  <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                    {runtimeForm.connectivity_targets.map((ct, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded bg-slate-900 px-2 py-1 text-xs">
                        <span className="font-semibold text-slate-200">{ct.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-400">{ct.ip}</span>
                          <button
                            type="button"
                            onClick={() => removeTargetFromRuntime(idx)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">No targets added to this template.</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRuntimeModalOpen(false)}
                disabled={savingRuntime}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void saveRuntime()}
                disabled={savingRuntime}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {savingRuntime ? "Saving..." : editingRuntimeId ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== Widget Template Modal ===================== */}
      {widgetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-400" />
                {editingWidgetId ? "Edit Widget Template" : "New Widget Template"}
              </h2>
              <button
                onClick={() => setWidgetModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4 py-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-300">Widget Name *</Label>
                  <Input
                    type="text"
                    placeholder="e.g. Integration Logs"
                    value={widgetForm.name}
                    onChange={(e) => setWidgetForm({ ...widgetForm, name: e.target.value })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-300">Status</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWidgetForm({ ...widgetForm, enabled: !widgetForm.enabled })}
                    className={`h-8 justify-start text-xs border-slate-700 ${
                      widgetForm.enabled ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400 bg-slate-950"
                    }`}
                  >
                    {widgetForm.enabled ? "Active (Enabled)" : "Paused (Disabled)"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                <Label className="text-xs text-slate-300">Description</Label>
                <Input
                  type="text"
                  placeholder="e.g. Tracks SUCCESS vs FAILED upload calls over the last hour"
                  value={widgetForm.description}
                  onChange={(e) => setWidgetForm({ ...widgetForm, description: e.target.value })}
                  className="h-8 text-xs bg-slate-950 border-slate-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-300">Database Name *</Label>
                  <Input
                    type="text"
                    placeholder="e.g. data_uploader_service"
                    value={widgetForm.database}
                    onChange={(e) => setWidgetForm({ ...widgetForm, database: e.target.value })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-300">Collection Name *</Label>
                  <Input
                    type="text"
                    placeholder="e.g. integration_logs"
                    value={widgetForm.collection}
                    onChange={(e) => setWidgetForm({ ...widgetForm, collection: e.target.value })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-300">Group By Field</Label>
                  <Input
                    type="text"
                    placeholder="e.g. upload_status"
                    value={widgetForm.group_by_field}
                    onChange={(e) => setWidgetForm({ ...widgetForm, group_by_field: e.target.value })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-300">Timestamp Field</Label>
                  <Input
                    type="text"
                    placeholder="e.g. created_at"
                    value={widgetForm.time_field}
                    onChange={(e) => setWidgetForm({ ...widgetForm, time_field: e.target.value })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">Poll Interval (s)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={widgetForm.poll_interval_seconds}
                    onChange={(e) => setWidgetForm({ ...widgetForm, poll_interval_seconds: parseInt(e.target.value) || 60 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">Lookback Window (m)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10080}
                    value={widgetForm.window_minutes}
                    onChange={(e) => setWidgetForm({ ...widgetForm, window_minutes: parseInt(e.target.value) || 60 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-slate-400">Max Groups</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={widgetForm.max_groups}
                    onChange={(e) => setWidgetForm({ ...widgetForm, max_groups: parseInt(e.target.value) || 10 })}
                    className="h-8 text-xs bg-slate-950 border-slate-700"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex flex-col gap-3">
                <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Integration Failure Alert Sensitivity
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-slate-300">Failure Threshold (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={widgetForm.alert_threshold_percent}
                      onChange={(e) => setWidgetForm({ ...widgetForm, alert_threshold_percent: parseFloat(e.target.value) || 50.0 })}
                      className="h-8 text-xs bg-slate-950 border-slate-700 text-amber-200"
                    />
                    <span className="text-[10px] text-slate-400">Raise warning when failure rate exceeds this %</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-slate-300">Alert Window (minutes)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10080}
                      value={widgetForm.alert_window_minutes}
                      onChange={(e) => setWidgetForm({ ...widgetForm, alert_window_minutes: parseInt(e.target.value) || 15 })}
                      className="h-8 text-xs bg-slate-950 border-slate-700 text-amber-200"
                    />
                    <span className="text-[10px] text-slate-400">Look back this many minutes for failure calculation</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWidgetModalOpen(false)}
                disabled={savingWidget}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void saveWidget()}
                disabled={savingWidget}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {savingWidget ? "Saving..." : editingWidgetId ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
