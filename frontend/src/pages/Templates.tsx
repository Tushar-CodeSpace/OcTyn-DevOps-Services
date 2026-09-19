import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
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
import type { AgentRuntimeTemplate, ConnectivityTarget, Server, Site, WidgetTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  target_site_ids: [] as string[],
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
  include_values: [] as string[],
  exclude_values: [] as string[],
  target_site_ids: [] as string[],
};

export default function TemplatesPage() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("runtime");
  const [search, setSearch] = useState("");

  const [runtimeTemplates, setRuntimeTemplates] = useState<AgentRuntimeTemplate[]>([]);
  const [widgetTemplates, setWidgetTemplates] = useState<WidgetTemplate[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
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
  const [widgetIncludeRaw, setWidgetIncludeRaw] = useState("");
  const [widgetExcludeRaw, setWidgetExcludeRaw] = useState("");
  const [savingWidget, setSavingWidget] = useState(false);

  // Assign Sites Quick Modal state
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTemplateKind, setAssignTemplateKind] = useState<"runtime" | "widget">("runtime");
  const [assignTemplateId, setAssignTemplateId] = useState<string>("");
  const [assignTemplateName, setAssignTemplateName] = useState<string>("");
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      loadAllTemplates();
    }
  }, [isAdmin]);

  async function loadAllTemplates() {
    setLoading(true);
    try {
      const [runtimes, widgets, sitesData, serversData] = await Promise.all([
        apiFetch<AgentRuntimeTemplate[]>("/agent-config-templates").catch(() => []),
        apiFetch<WidgetTemplate[]>("/widgets/templates").catch(() => []),
        apiFetch<Site[]>("/sites").catch(() => []),
        apiFetch<Server[]>("/servers").catch(() => []),
      ]);
      setRuntimeTemplates(runtimes);
      setWidgetTemplates(widgets);
      setSites(sitesData);
      setServers(serversData);
    } catch {
      showToast({ severity: "critical", title: "Load error", message: "Failed to load templates." });
    } finally {
      setLoading(false);
    }
  }

  function getSiteEquipmentList(site: Site): string[] {
    const fromSite =
      site.equipment_names && site.equipment_names.length > 0
        ? site.equipment_names
        : site.equipment_name
        ? [site.equipment_name]
        : [];
    const fromServers = servers
      .filter((srv) => srv.site_id === site.id && srv.name)
      .map((srv) => srv.name.trim());
    return Array.from(new Set([...fromSite, ...fromServers])).filter(Boolean);
  }

  // Filtered lists
  const filteredRuntimes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return runtimeTemplates;
    return runtimeTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.used_by_sites || []).some((s) => s.client.toLowerCase().includes(q) || s.location.toLowerCase().includes(q)) ||
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
        (w.used_by_sites || []).some((s) => s.client.toLowerCase().includes(q) || s.location.toLowerCase().includes(q)) ||
        w.group_by_field.toLowerCase().includes(q)
    );
  }, [widgetTemplates, search]);

  // ===================== Site Assignment Handlers =====================

  function openAssignSitesModal(template: AgentRuntimeTemplate | WidgetTemplate, kind: "runtime" | "widget") {
    setAssignTemplateKind(kind);
    setAssignTemplateId(template.id);
    setAssignTemplateName(template.name);
    const currentlyAssigned = (template.used_by_sites || []).map((s) => s.site_id);
    setSelectedSiteIds(currentlyAssigned);
    setAssignModalOpen(true);
  }

  async function saveSiteAssignment() {
    setSavingAssignment(true);
    try {
      const endpoint =
        assignTemplateKind === "runtime"
          ? `/agent-config-templates/${assignTemplateId}/assign-sites`
          : `/widgets/templates/${assignTemplateId}/assign-sites`;

      const updated = await apiFetch<AgentRuntimeTemplate | WidgetTemplate>(endpoint, {
        method: "POST",
        body: JSON.stringify({ site_ids: selectedSiteIds }),
      });

      if (assignTemplateKind === "runtime") {
        setRuntimeTemplates((prev) =>
          prev.map((t) => (t.id === assignTemplateId ? (updated as AgentRuntimeTemplate) : t))
        );
      } else {
        setWidgetTemplates((prev) =>
          prev.map((w) => (w.id === assignTemplateId ? (updated as WidgetTemplate) : w))
        );
      }

      const count = updated.used_by_sites?.length || 0;
      const siteNames = (updated.used_by_sites || []).map((s) => s.client).join(", ");
      showToast({
        severity: "info",
        title: "Sites assignment updated",
        message:
          count > 0
            ? `"${assignTemplateName}" assigned to ${count} site(s) (${siteNames}). Updates will sync to these sites only.`
            : `"${assignTemplateName}" is no longer assigned to any sites.`,
      });
      setAssignModalOpen(false);
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Assignment failed",
        message: err instanceof Error ? err.message : "Failed to assign sites.",
      });
    } finally {
      setSavingAssignment(false);
    }
  }

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
      target_site_ids: (t.used_by_sites || []).map((s) => s.site_id),
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
      target_site_ids: [],
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
        const count = updated.used_by_sites?.length || 0;
        const sitesList = (updated.used_by_sites || []).map((s) => s.client).join(", ");
        showToast({
          severity: "info",
          title: "Template updated",
          message:
            count > 0
              ? `"${updated.name}" saved & synced to ${count} site(s) only (${sitesList}).`
              : `"${updated.name}" saved. (Not assigned to any sites yet).`,
        });
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

  async function applyRuntimeToAll(t: AgentRuntimeTemplate) {
    if (
      !confirm(
        `Apply runtime template "${t.name}" to ALL site servers across your fleet? All servers will immediately update to these monitoring and ping settings.`
      )
    ) {
      return;
    }
    try {
      const res = await apiFetch<{ success: boolean; applied_servers_count: number }>(
        `/agent-config-templates/${t.id}/apply-all`,
        { method: "POST" }
      );
      showToast({
        severity: "info",
        title: "Fleet synced",
        message: `Template "${t.name}" applied across ${res.applied_servers_count} site server(s).`,
      });
      loadAllTemplates();
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Sync failed",
        message: err instanceof Error ? err.message : "Could not apply template across servers.",
      });
    }
  }

  async function deleteRuntime(t: AgentRuntimeTemplate) {
    if (
      !confirm(
        `Are you sure you want to delete runtime template "${t.name}"? Servers currently using these settings are unaffected.`
      )
    ) {
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
    setWidgetIncludeRaw("");
    setWidgetExcludeRaw("");
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
      include_values: w.include_values || [],
      exclude_values: w.exclude_values || [],
      target_site_ids: (w.used_by_sites || []).map((s) => s.site_id),
    });
    setWidgetIncludeRaw((w.include_values || []).join(", "));
    setWidgetExcludeRaw((w.exclude_values || []).join(", "));
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
      include_values: w.include_values || [],
      exclude_values: w.exclude_values || [],
      target_site_ids: [],
    });
    setWidgetIncludeRaw((w.include_values || []).join(", "));
    setWidgetExcludeRaw((w.exclude_values || []).join(", "));
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
        const count = updated.used_by_sites?.length || 0;
        const sitesList = (updated.used_by_sites || []).map((s) => s.client).join(", ");
        showToast({
          severity: "info",
          title: "Template updated",
          message:
            count > 0
              ? `"${updated.name}" saved & synced to ${count} site(s) only (${sitesList}).`
              : `"${updated.name}" saved. (Not assigned to any sites yet).`,
        });
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

  async function applyWidgetToAll(w: WidgetTemplate) {
    if (
      !confirm(
        `Deploy widget template "${w.name}" to ALL site servers across your fleet? All servers will automatically start collecting telemetry for this query.`
      )
    ) {
      return;
    }
    try {
      const res = await apiFetch<{ success: boolean; applied_servers_count: number }>(
        `/widgets/templates/${w.id}/apply-all`,
        { method: "POST" }
      );
      showToast({
        severity: "info",
        title: "Fleet synced",
        message: `Widget "${w.name}" applied across ${res.applied_servers_count} site server(s).`,
      });
      loadAllTemplates();
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Sync failed",
        message: err instanceof Error ? err.message : "Could not apply widget template across servers.",
      });
    }
  }

  async function deleteWidget(w: WidgetTemplate) {
    if (
      !confirm(
        `Are you sure you want to delete widget template "${w.name}"? Servers currently using this widget are unaffected.`
      )
    ) {
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
            Define reusable runtime settings and custom MongoDB widgets. Templates sync strictly to the sites using them.
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
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                activeTab === "runtime" ? "bg-indigo-400/25 text-white" : "bg-slate-800 text-slate-400"
              }`}
            >
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
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                activeTab === "widget" ? "bg-emerald-400/25 text-white" : "bg-slate-800 text-slate-400"
              }`}
            >
              {widgetTemplates.length}
            </span>
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            type="text"
            placeholder="Search templates or sites..."
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
            <div key={i} className="h-48 rounded-xl border border-slate-800/60 bg-slate-900/40 animate-pulse" />
          ))}
        </div>
      ) : activeTab === "runtime" ? (
        filteredRuntimes.length === 0 ? (
          <Card className="border-slate-800 bg-slate-900/40 py-12 text-center">
            <CardContent className="flex flex-col items-center justify-center">
              <SlidersHorizontal className="h-10 w-10 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No runtime templates found</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Runtime templates allow you to define monitoring intervals, timeouts, and ping targets once, and deploy them to specific client sites.
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
                      <span className="font-semibold text-slate-200">
                        {t.http_timeout_seconds}s ({t.http_retry_count} retries)
                      </span>
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

                  {/* Used by Sites Section */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Used in Sites ({t.used_by_sites?.length || 0}):</span>
                      </span>
                      {t.applied_servers_count !== undefined && t.applied_servers_count > 0 && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {t.applied_servers_count} {t.applied_servers_count === 1 ? "node" : "nodes"}
                        </span>
                      )}
                    </div>

                    {t.used_by_sites && t.used_by_sites.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1">
                        {t.used_by_sites.map((s) => (
                          <span
                            key={s.site_id}
                            title={`Servers: ${s.servers.join(", ")}`}
                            className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-950/40 px-2 py-0.5 text-[10px] text-indigo-200"
                          >
                            <Building2 className="h-2.5 w-2.5 text-indigo-400 shrink-0" />
                            <span className="font-semibold text-slate-100">{s.client}</span>
                            <span className="text-slate-400">· {s.location || s.code}</span>
                            <span className="font-mono text-[9px] bg-indigo-900/60 px-1 rounded text-indigo-300">
                              {s.server_count}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-950/40 px-2.5 py-1.5">
                        <span className="text-[11px] text-slate-500 italic">Not linked to any sites</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-1">
                    <span className="text-[10px] text-slate-500">
                      Updated {new Date(t.updated_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      {/* Assign Sites Button */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAssignSitesModal(t, "runtime")}
                        title="Assign template to specific sites (updates sync to these sites only)"
                        className="h-7 px-2 text-[11px] text-indigo-300 hover:text-white bg-indigo-950/30 hover:bg-indigo-900/40 border-indigo-500/30 gap-1"
                      >
                        <Building2 className="h-3 w-3 text-indigo-400" />
                        <span>Assign Sites</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => applyRuntimeToAll(t)}
                        title="Apply this template to ALL site servers across the fleet"
                        className="h-7 px-2 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/40 border border-indigo-500/20"
                      >
                        <Radio className="h-3 w-3 mr-1 text-indigo-400" />
                        <span className="text-[11px] font-medium">Sync All</span>
                      </Button>
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
                Widget templates define periodic count queries on site MongoDB collections to deploy to specific client sites.
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

                  {/* Include / Exclude Key Values Filters */}
                  {((w.include_values && w.include_values.length > 0) || (w.exclude_values && w.exclude_values.length > 0)) && (
                    <div className="flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/40 p-2 text-[11px]">
                      {w.include_values && w.include_values.length > 0 && (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className="text-emerald-400 font-mono text-[10px] uppercase font-semibold shrink-0">Inc:</span>
                          <span className="font-mono text-slate-300 truncate" title={w.include_values.join(", ")}>
                            {w.include_values.join(", ")}
                          </span>
                        </div>
                      )}
                      {w.exclude_values && w.exclude_values.length > 0 && (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className="text-rose-400 font-mono text-[10px] uppercase font-semibold shrink-0">Exc:</span>
                          <span className="font-mono text-slate-300 truncate" title={w.exclude_values.join(", ")}>
                            {w.exclude_values.join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Failure Alert settings */}
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-slate-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Failure Threshold:
                    </span>
                    <span className="font-semibold text-amber-300">
                      {w.alert_threshold_percent ?? 50}%{" "}
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({w.alert_window_minutes ?? 15}m window)
                      </span>
                    </span>
                  </div>

                  {/* Used by Sites Section */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Used in Sites ({w.used_by_sites?.length || 0}):</span>
                      </span>
                      {w.applied_servers_count !== undefined && w.applied_servers_count > 0 && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {w.applied_servers_count} {w.applied_servers_count === 1 ? "node" : "nodes"}
                        </span>
                      )}
                    </div>

                    {w.used_by_sites && w.used_by_sites.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1">
                        {w.used_by_sites.map((s) => (
                          <span
                            key={s.site_id}
                            title={`Servers: ${s.servers.join(", ")}`}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-200"
                          >
                            <Building2 className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                            <span className="font-semibold text-slate-100">{s.client}</span>
                            <span className="text-slate-400">· {s.location || s.code}</span>
                            <span className="font-mono text-[9px] bg-emerald-900/60 px-1 rounded text-emerald-300">
                              {s.server_count}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-950/40 px-2.5 py-1.5">
                        <span className="text-[11px] text-slate-500 italic">Not linked to any sites</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-1">
                    <span className="text-[10px] text-slate-500">
                      Updated {new Date(w.updated_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      {/* Assign Sites Button */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAssignSitesModal(w, "widget")}
                        title="Assign widget to specific sites (updates sync to these sites only)"
                        className="h-7 px-2 text-[11px] text-emerald-300 hover:text-white bg-emerald-950/30 hover:bg-emerald-900/40 border-emerald-500/30 gap-1"
                      >
                        <Building2 className="h-3 w-3 text-emerald-400" />
                        <span>Assign Sites</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => applyWidgetToAll(w)}
                        title="Apply this widget to ALL site servers across the fleet"
                        className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-emerald-500/20"
                      >
                        <Database className="h-3 w-3 mr-1 text-emerald-400" />
                        <span className="text-[11px] font-medium">Sync All</span>
                      </Button>
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

      {/* ===================== Assign Sites Modal ===================== */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "p-2 rounded-lg border",
                    assignTemplateKind === "runtime"
                      ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  )}
                >
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-100">Assign Template to Sites</h2>
                  <p className="text-xs text-slate-400">
                    Template: <strong className="text-slate-200">{assignTemplateName}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="py-4 text-xs flex flex-col gap-3 overflow-y-auto">
              <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 p-2.5 text-sky-300">
                <span>
                  Changes made to this template will automatically synchronize to servers in the selected sites only.
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 px-0.5">
                <span>Select Client Sites ({selectedSiteIds.length} of {sites.length} selected):</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedSiteIds(sites.map((s) => s.id))}
                    className="text-sky-400 hover:underline text-[11px]"
                  >
                    Select All
                  </button>
                  <span>·</span>
                  <button
                    onClick={() => setSelectedSiteIds([])}
                    className="text-slate-400 hover:underline text-[11px]"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                {sites.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">No client sites configured in fleet.</p>
                ) : (
                  sites.map((s) => {
                    const isSelected = selectedSiteIds.includes(s.id);
                    const equipList = getSiteEquipmentList(s);
                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          setSelectedSiteIds((prev) =>
                            prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                          );
                        }}
                        className={cn(
                          "flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all",
                          isSelected
                            ? "border-sky-500/40 bg-slate-800/90 text-slate-100 shadow-sm"
                            : "border-slate-800/80 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <div
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded border transition-colors shrink-0",
                              isSelected
                                ? "border-sky-500 bg-sky-600 text-white"
                                : "border-slate-600 bg-slate-950 text-transparent"
                            )}
                          >
                            <Check className="h-3 w-3" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-xs text-slate-200 truncate">{s.client}</span>
                              {equipList.length > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
                                  title={`Equipment: ${equipList.join(", ")}`}
                                >
                                  <Cpu className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                                  <span className="truncate max-w-[200px]">{equipList.join(", ")}</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 truncate">
                              {s.location} ({s.code})
                            </span>
                          </div>
                        </div>

                        <span
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border shrink-0",
                            isSelected
                              ? "border-sky-500/40 bg-sky-950/40 text-sky-300"
                              : "border-slate-800 bg-slate-900 text-slate-500"
                          )}
                        >
                          {isSelected ? "Assigned" : "Unassigned"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Selected: <strong className="text-sky-300">{selectedSiteIds.length}</strong> site(s)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAssignModalOpen(false)}
                  className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveSiteAssignment}
                  disabled={savingAssignment}
                  className="bg-sky-600 hover:bg-sky-500 text-white"
                >
                  {savingAssignment ? "Saving..." : "Save Site Assignment"}
                </Button>
              </div>
            </div>
          </div>
        </div>
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
                  placeholder="e.g. Standard Edge Agent Profile"
                  value={runtimeForm.name}
                  onChange={(e) => setRuntimeForm({ ...runtimeForm, name: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                <Label className="text-xs text-slate-300">Description</Label>
                <Input
                  placeholder="e.g. Applied to all standard site agents with 15s ping rate"
                  value={runtimeForm.description}
                  onChange={(e) => setRuntimeForm({ ...runtimeForm, description: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-xs"
                />
              </div>

              {/* Intervals Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Telemetry Push Interval (seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={runtimeForm.monitoring_interval_seconds}
                    onChange={(e) =>
                      setRuntimeForm({ ...runtimeForm, monitoring_interval_seconds: Number(e.target.value) })
                    }
                    className="bg-slate-900 border-slate-800 text-xs"
                  />
                  <span className="text-[10px] text-slate-500">How often agent sends CPU, RAM & Disk metrics</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Config Poller Interval (seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={runtimeForm.config_poll_interval_seconds}
                    onChange={(e) =>
                      setRuntimeForm({ ...runtimeForm, config_poll_interval_seconds: Number(e.target.value) })
                    }
                    className="bg-slate-900 border-slate-800 text-xs"
                  />
                  <span className="text-[10px] text-slate-500">How quickly agent pulls setting changes</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Device Ping Interval (seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={runtimeForm.connectivity_poll_interval_seconds}
                    onChange={(e) =>
                      setRuntimeForm({ ...runtimeForm, connectivity_poll_interval_seconds: Number(e.target.value) })
                    }
                    className="bg-slate-900 border-slate-800 text-xs"
                  />
                  <span className="text-[10px] text-slate-500">How often agent tests local IP targets</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">HTTP Timeout (seconds)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={runtimeForm.http_timeout_seconds}
                      onChange={(e) =>
                        setRuntimeForm({ ...runtimeForm, http_timeout_seconds: Number(e.target.value) })
                      }
                      className="bg-slate-900 border-slate-800 text-xs w-24"
                    />
                    <span className="text-slate-400">Retries:</span>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={runtimeForm.http_retry_count}
                      onChange={(e) =>
                        setRuntimeForm({ ...runtimeForm, http_retry_count: Number(e.target.value) })
                      }
                      className="bg-slate-900 border-slate-800 text-xs w-20"
                    />
                  </div>
                </div>
              </div>

              {/* Target Sites Selection inside Modal */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Assign to Sites (Changes will sync to these sites only)</span>
                  </Label>
                  <span className="text-[10px] text-slate-400">
                    {runtimeForm.target_site_ids.length} selected
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Select which client sites use this template. Any changes saved to this template will automatically synchronize to servers in these selected sites only.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {sites.map((s) => {
                    const isChecked = runtimeForm.target_site_ids.includes(s.id);
                    const equipList = getSiteEquipmentList(s);
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-colors",
                          isChecked
                            ? "border-indigo-500/50 bg-indigo-950/40 text-slate-100"
                            : "border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRuntimeForm((prev) => ({
                                ...prev,
                                target_site_ids: [...prev.target_site_ids, s.id],
                              }));
                            } else {
                              setRuntimeForm((prev) => ({
                                ...prev,
                                target_site_ids: prev.target_site_ids.filter((id) => id !== s.id),
                              }));
                            }
                          }}
                          className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold truncate">{s.client}</span>
                            {equipList.length > 0 && (
                              <span
                                className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-950/50 px-1.5 py-0.2 text-[9px] font-medium text-indigo-300"
                                title={`Equipment: ${equipList.join(", ")}`}
                              >
                                <Cpu className="h-2.5 w-2.5 text-indigo-400 shrink-0" />
                                <span className="truncate max-w-[150px]">{equipList.join(", ")}</span>
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 truncate">
                            {s.location} ({s.code})
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Ping Connectivity Targets */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Radio className="h-3.5 w-3.5 text-sky-400" />
                  <span>Connectivity Targets ({runtimeForm.connectivity_targets.length})</span>
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    placeholder="Device name (e.g. PLC-1, Scanner)"
                    value={newTargetName}
                    onChange={(e) => setNewTargetName(e.target.value)}
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                  <Input
                    placeholder="IP / Host (e.g. 192.168.1.50)"
                    value={newTargetIp}
                    onChange={(e) => setNewTargetIp(e.target.value)}
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                  <Button
                    type="button"
                    onClick={addTargetToRuntime}
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white shrink-0"
                  >
                    Add Target
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 mt-1">
                  {runtimeForm.connectivity_targets.map((ct, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-200"
                    >
                      <span className="font-semibold text-sky-300">{ct.name}:</span>
                      <span className="font-mono text-slate-400">{ct.ip}</span>
                      <button
                        onClick={() => removeTargetFromRuntime(idx)}
                        className="text-slate-400 hover:text-red-400 ml-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRuntimeModalOpen(false)}
                className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveRuntime}
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
                <div className="grid grid-cols-1 gap-1.5">
                  <Label className="text-xs text-slate-300">Widget Name *</Label>
                  <Input
                    placeholder="e.g. Integration Logs Status"
                    value={widgetForm.name}
                    onChange={(e) => setWidgetForm({ ...widgetForm, name: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  <Label className="text-xs text-slate-300">Status</Label>
                  <label className="flex items-center gap-2 cursor-pointer pt-2">
                    <input
                      type="checkbox"
                      checked={widgetForm.enabled}
                      onChange={(e) => setWidgetForm({ ...widgetForm, enabled: e.target.checked })}
                      className="rounded border-slate-700 text-emerald-600 focus:ring-0"
                    />
                    <span className="text-slate-300">Enabled for polling on agents</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                <Label className="text-xs text-slate-300">Description</Label>
                <Input
                  placeholder="e.g. Periodic status breakdown for data uploader pipeline"
                  value={widgetForm.description}
                  onChange={(e) => setWidgetForm({ ...widgetForm, description: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-xs"
                />
              </div>

              {/* Database & Collection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">MongoDB Database *</Label>
                  <Input
                    placeholder="e.g. data_uploader_service"
                    value={widgetForm.database}
                    onChange={(e) => setWidgetForm({ ...widgetForm, database: e.target.value })}
                    className="bg-slate-900 border-slate-800 text-xs font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">MongoDB Collection *</Label>
                  <Input
                    placeholder="e.g. integration_logs"
                    value={widgetForm.collection}
                    onChange={(e) => setWidgetForm({ ...widgetForm, collection: e.target.value })}
                    className="bg-slate-900 border-slate-800 text-xs font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Group By Field</Label>
                  <Input
                    placeholder="e.g. upload_status"
                    value={widgetForm.group_by_field}
                    onChange={(e) => setWidgetForm({ ...widgetForm, group_by_field: e.target.value })}
                    className="bg-slate-900 border-slate-800 text-xs font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Time Field</Label>
                  <Input
                    placeholder="e.g. created_at"
                    value={widgetForm.time_field}
                    onChange={(e) => setWidgetForm({ ...widgetForm, time_field: e.target.value })}
                    className="bg-slate-900 border-slate-800 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Include & Exclude Key Values */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">
                    Include Key Values <span className="text-[10px] text-slate-500">(Optional comma-separated)</span>
                  </Label>
                  <Input
                    placeholder="e.g. SUCCESS, DELIVERED, 200"
                    value={widgetIncludeRaw}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWidgetIncludeRaw(val);
                      const parsed = val.split(",").map((s) => s.trim()).filter(Boolean);
                      setWidgetForm((prev) => ({ ...prev, include_values: parsed }));
                    }}
                    className="bg-slate-900 border-slate-800 text-xs font-mono"
                  />
                  <p className="text-[10px] text-slate-500">
                    If set, only documents matching these values for &quot;{widgetForm.group_by_field || "group_by_field"}&quot; will be counted.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">
                    Exclude Key Values <span className="text-[10px] text-slate-500">(Optional comma-separated)</span>
                  </Label>
                  <Input
                    placeholder="e.g. SKIPPED, CANCELLED, null"
                    value={widgetExcludeRaw}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWidgetExcludeRaw(val);
                      const parsed = val.split(",").map((s) => s.trim()).filter(Boolean);
                      setWidgetForm((prev) => ({ ...prev, exclude_values: parsed }));
                    }}
                    className="bg-slate-900 border-slate-800 text-xs font-mono"
                  />
                  <p className="text-[10px] text-slate-500">
                    Documents with these values will be omitted from counts and group breakdown.
                  </p>
                </div>
              </div>

              {/* Intervals & Window */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Poll Interval (seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={widgetForm.poll_interval_seconds}
                    onChange={(e) =>
                      setWidgetForm({ ...widgetForm, poll_interval_seconds: Number(e.target.value) })
                    }
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Time Window (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10080}
                    value={widgetForm.window_minutes}
                    onChange={(e) =>
                      setWidgetForm({ ...widgetForm, window_minutes: Number(e.target.value) })
                    }
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-slate-300">Max Groups</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={widgetForm.max_groups}
                    onChange={(e) => setWidgetForm({ ...widgetForm, max_groups: Number(e.target.value) })}
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                </div>
              </div>

              {/* Failure Alert settings */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex flex-col gap-2.5">
                <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  Integration Failure Alert Configuration
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-slate-300">Failure Threshold (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={widgetForm.alert_threshold_percent}
                      onChange={(e) =>
                        setWidgetForm({ ...widgetForm, alert_threshold_percent: Number(e.target.value) })
                      }
                      className="bg-slate-950 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-slate-300">Failure Window (minutes)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10080}
                      value={widgetForm.alert_window_minutes}
                      onChange={(e) =>
                        setWidgetForm({ ...widgetForm, alert_window_minutes: Number(e.target.value) })
                      }
                      className="bg-slate-950 border-slate-800 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Target Sites Selection inside Modal */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Assign to Sites (Changes will sync to these sites only)</span>
                  </Label>
                  <span className="text-[10px] text-slate-400">
                    {widgetForm.target_site_ids.length} selected
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Select which client sites use this widget. Any changes saved to this template will automatically synchronize to servers in these selected sites only.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {sites.map((s) => {
                    const isChecked = widgetForm.target_site_ids.includes(s.id);
                    const equipList = getSiteEquipmentList(s);
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-colors",
                          isChecked
                            ? "border-emerald-500/50 bg-emerald-950/40 text-slate-100"
                            : "border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setWidgetForm((prev) => ({
                                ...prev,
                                target_site_ids: [...prev.target_site_ids, s.id],
                              }));
                            } else {
                              setWidgetForm((prev) => ({
                                ...prev,
                                target_site_ids: prev.target_site_ids.filter((id) => id !== s.id),
                              }));
                            }
                          }}
                          className="rounded border-slate-700 text-emerald-600 focus:ring-0"
                        />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold truncate">{s.client}</span>
                            {equipList.length > 0 && (
                              <span
                                className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-950/50 px-1.5 py-0.2 text-[9px] font-medium text-emerald-300"
                                title={`Equipment: ${equipList.join(", ")}`}
                              >
                                <Cpu className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                                <span className="truncate max-w-[150px]">{equipList.join(", ")}</span>
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 truncate">
                            {s.location} ({s.code})
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWidgetModalOpen(false)}
                className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveWidget}
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
