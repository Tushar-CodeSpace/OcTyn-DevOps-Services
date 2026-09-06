import { useEffect, useState } from "react";
import { BellOff, Key, Lock, Save } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { showToast } from "@/components/ToastHost";
import type { AlertConfig, Server, Site } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const FIELDS: {
  key: Exclude<keyof AlertConfig, "config_sync_enabled">;
  label: string;
  hint: string;
  min: number;
  max?: number;
}[] = [
  {
    key: "ram_threshold_percent",
    label: "Memory alert threshold (%)",
    hint: "Raise a warning when a server's memory usage exceeds this share of total RAM.",
    min: 0,
    max: 100,
  },
  {
    key: "cpu_threshold_percent",
    label: "CPU alert threshold (%)",
    hint: "CPU level that starts counting towards a sustained-CPU warning.",
    min: 0,
    max: 100,
  },
  {
    key: "cpu_duration_seconds",
    label: "CPU sustained window (seconds)",
    hint: "How long CPU must stay above its threshold before the warning fires.",
    min: 30,
  },
  {
    key: "disk_threshold_percent",
    label: "Disk alert threshold (%)",
    hint: "Raise a warning when a server's disk usage exceeds this share.",
    min: 0,
    max: 100,
  },
  {
    key: "api_error_threshold_percent",
    label: "API Error alert threshold (%)",
    hint: "Trigger an alert if HTTP 400-500 errors exceed this percentage of total API calls across site microservices.",
    min: 0,
    max: 100,
  },
  {
    key: "offline_threshold_seconds",
    label: "Server Offline Heartbeat Timeout (seconds)",
    hint: "If a site server stops sending heartbeats for longer than this duration, log a Critical Server Offline alert.",
    min: 15,
  },
  {
    key: "config_sync_hour",
    label: "Daily config backup hour (0-23)",
    hint: "Hour of day when site agents upload MongoDB config snapshots to the hub (24h clock, local agent time). Agents pick up changes on their next heartbeat.",
    min: 0,
    max: 23,
  },
];

export default function Settings() {
  const { user: currentUser, isAdmin } = useAuth();
  const [form, setForm] = useState<AlertConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Per-site alert management state
  const [sites, setSites] = useState<Site[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [updatingSiteId, setUpdatingSiteId] = useState<string | null>(null);

  // Personal Password Change State
  const [passForm, setPassForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [changingPass, setChangingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<AlertConfig>("/settings").catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load settings");
        return null;
      }),
      apiFetch<Site[]>("/sites").catch(() => []),
      apiFetch<Server[]>("/servers").catch(() => []),
    ]).then(([cfg, fetchedSites, fetchedServers]) => {
      if (cfg) setForm(cfg);
      setSites(fetchedSites || []);
      setServers(fetchedServers || []);
      setLoadingSites(false);
    });
  }, []);

  async function handleChangeMyPassword(e: React.FormEvent) {
    e.preventDefault();
    setPassError(null);
    if (!passForm.currentPassword || !passForm.newPassword) return;
    if (passForm.newPassword !== passForm.confirmPassword) {
      setPassError("New password and confirm password do not match.");
      return;
    }
    if (passForm.newPassword.length < 8) {
      setPassError("New password must be at least 8 characters long.");
      return;
    }

    setChangingPass(true);
    try {
      await apiFetch<{ message: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: passForm.currentPassword,
          new_password: passForm.newPassword,
        }),
      });
      setPassForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast({
        severity: "info",
        title: "Password Updated",
        message: "Your password has been changed successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to change password";
      setPassError(msg);
      showToast({
        severity: "critical",
        title: "Change Password Failed",
        message: msg,
      });
    } finally {
      setChangingPass(false);
    }
  }

  function update(key: Exclude<keyof AlertConfig, "config_sync_enabled">, raw: string) {
    setForm((prev) => (prev ? { ...prev, [key]: Number(raw) } : prev));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const saved = await apiFetch<AlertConfig>("/settings", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setForm(saved);
      showToast({
        severity: "info",
        title: "Settings saved",
        message: "New thresholds apply from the next evaluation cycle (≤ 5s).",
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Save failed",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleSiteAlerts(site: Site, newEnabledState: boolean) {
    if (!isAdmin || updatingSiteId) return;
    setUpdatingSiteId(site.id);
    try {
      const updated = await apiFetch<Site>(`/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({ alerts_enabled: newEnabledState }),
      });
      setSites((prev) => prev.map((s) => (s.id === site.id ? updated : s)));
      showToast({
        severity: newEnabledState ? "info" : "warning",
        title: newEnabledState ? "Alerts Enabled" : "Alerts Muted",
        message: `Alerts are now ${newEnabledState ? "ACTIVE" : "MUTED"} for client site ${site.client} (${site.location}).`,
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Update Failed",
        message: err instanceof Error ? err.message : "Failed to update site alert settings",
      });
    } finally {
      setUpdatingSiteId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-400">
          Personal account security, central alert thresholds, and per-site alert controls
        </p>
      </div>

      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column (7 cols): Personal Account + Alert Thresholds */}
        <div className="flex flex-col gap-6 lg:col-span-7">
          {/* Personal Account & Password Change Section (For ALL Users) */}
          <Card className="border-sky-500/30 bg-slate-900/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Lock className="h-4 w-4 text-sky-400" />
                My Profile & Password Settings
              </CardTitle>
              <p className="text-xs text-slate-400">
                Logged in as <span className="font-semibold text-slate-200">{currentUser?.email}</span> (
                <span className="text-sky-400 font-medium capitalize">{currentUser?.role}</span>). Update your account password below.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangeMyPassword} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-slate-400">Current Password *</Label>
                    <Input
                      type="password"
                      required
                      placeholder="Current password"
                      value={passForm.currentPassword}
                      onChange={(e) => setPassForm({ ...passForm, currentPassword: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-slate-400">New Password *</Label>
                    <Input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Min 8 chars"
                      value={passForm.newPassword}
                      onChange={(e) => setPassForm({ ...passForm, newPassword: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-slate-400">Confirm New Password *</Label>
                    <Input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Repeat new password"
                      value={passForm.confirmPassword}
                      onChange={(e) => setPassForm({ ...passForm, confirmPassword: e.target.value })}
                    />
                  </div>
                </div>
                {passError && <p className="text-xs text-red-400 font-medium">{passError}</p>}
                <div className="mt-1 flex justify-end">
                  <Button type="submit" size="sm" disabled={changingPass} className="bg-sky-600 hover:bg-sky-500 text-white font-medium">
                    <Key className="mr-1.5 h-3.5 w-3.5" />
                    {changingPass ? "Updating Password…" : "Update Password"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Central Alert Thresholds & Backup Config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Alerts & site config backup</CardTitle>
              <p className="text-xs text-slate-500">
                Stored centrally and picked up by the alert engine within seconds — no restart needed.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {!form && !loadError ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ))
              ) : form ? (
                FIELDS.map(({ key, label, hint, min, max }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    {key === "config_sync_hour" && (
                      <div className="mt-2 border-t border-slate-800/70 pt-4">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
                          Site MongoDB config backup
                        </Label>
                      </div>
                    )}
                    <Label htmlFor={key} className="text-xs text-slate-400">
                      {label}
                    </Label>
                    <Input
                      id={key}
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      disabled={!isAdmin}
                      value={form[key]}
                      onChange={(e) => update(key, e.target.value)}
                    />
                    <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>
                  </div>
                ))
              ) : null}

              {form && (
                <label className="flex cursor-pointer select-none items-center gap-3 self-start">
                  <input
                    type="checkbox"
                    disabled={!isAdmin}
                    checked={form.config_sync_enabled}
                    onChange={(e) => setForm({ ...form, config_sync_enabled: e.target.checked })}
                    className="h-4 w-4 accent-emerald-500 disabled:opacity-50"
                  />
                  <span className="text-sm text-slate-300">Site config backup enabled</span>
                </label>
              )}

              {isAdmin && (
                <Button onClick={save} disabled={saving || !form} className="mt-2 self-start">
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (5 cols): Client & Site Alert Controls */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card className="border-amber-500/20 bg-slate-900/50 shadow-xl">
            <CardHeader className="border-b border-slate-800/80 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <BellOff className="h-4 w-4 text-amber-400" />
                  Client & Site Alert Controls
                </CardTitle>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400 border border-slate-700">
                  {sites.length} {sites.length === 1 ? "Site" : "Sites"}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed mt-1">
                Enable or disable automated alerts (CPU, RAM, Disk, Offline, Service stops) for specific client environments.
              </p>
              {!isAdmin && (
                <div className="mt-2 rounded-md bg-amber-500/10 p-2 border border-amber-500/20 text-[11px] text-amber-300/90 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>Only <strong>Admin</strong> or <strong>Super Admin</strong> can toggle site alerts.</span>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-4 flex flex-col gap-3">
              {loadingSites ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))
              ) : sites.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No client sites configured yet.</p>
              ) : (
                sites.map((site) => {
                  const isEnabled = site.alerts_enabled !== false;
                  const siteServersCount = servers.filter((s) => s.site_id === site.id).length;
                  const isSavingThis = updatingSiteId === site.id;

                  return (
                    <div
                      key={site.id}
                      className={`flex items-center justify-between p-3.5 rounded-lg border transition-all ${
                        isEnabled
                          ? "border-slate-800 bg-slate-900/90 hover:border-slate-700"
                          : "border-amber-500/30 bg-amber-950/20 hover:border-amber-500/40"
                      }`}
                    >
                      <div className="flex flex-col gap-1 pr-2 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-xs text-slate-200 truncate">
                            {site.client}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/80">
                            {site.code}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400">
                          <span>📍 {site.location}</span>
                          <span>•</span>
                          <span>{siteServersCount} {siteServersCount === 1 ? "server" : "servers"}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                            isEnabled
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          }`}
                        >
                          {isEnabled ? "Alerts Active" : "Alerts Muted"}
                        </span>

                        <label className={`relative inline-flex items-center ${isAdmin ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                          <input
                            type="checkbox"
                            disabled={!isAdmin || isSavingThis}
                            checked={isEnabled}
                            onChange={(e) => toggleSiteAlerts(site, e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
