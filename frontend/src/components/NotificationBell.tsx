import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { Alert, Server, Site } from "@/lib/types";

const PANEL_W = 360;

const SEV_DOT: Record<string, string> = {
  warning: "bg-amber-400",
  critical: "bg-red-500",
  info: "bg-sky-400",
};

const TYPE_LABEL: Record<string, string> = {
  ram_high: "Memory",
  cpu_high: "CPU",
  disk_high: "Disk",
  service_stopped: "Service",
  server_offline: "Server offline",
};

/** Bell in the sidebar brand row: dropdown listing active alerts/warnings. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Alert[]>([]);
  const [serverMap, setServerMap] = useState<Record<string, Server>>({});
  const [siteMap, setSiteMap] = useState<Record<string, Site>>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 64, left: 12 });
  const navigate = useNavigate();

  const load = useCallback(() => {
    Promise.all([
      apiFetch<Alert[]>("/alerts?status=active"),
      apiFetch<Server[]>("/servers"),
      apiFetch<Site[]>("/sites"),
    ])
      .then(([a, sv, st]) => {
        setItems(a);
        setServerMap(Object.fromEntries(sv.map((x) => [x.id, x])));
        setSiteMap(Object.fromEntries(st.map((x) => [x.id, x])));
      })
      .catch(() => {}); // silent: dropdown just stays empty on failure
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    const onChange = () => load();
    socket.on("alert_opened", onChange);
    socket.on("alert_resolved", onChange);
    return () => {
      socket.off("alert_opened", onChange);
      socket.off("alert_resolved", onChange);
    };
  }, [load]);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 10,
      left: Math.max(12, r.right - PANEL_W),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  function toggle() {
    if (!open) load();
    setOpen((o) => !o);
  }

  const badge = items.length;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Active alerts"
        className={cn(
          "relative rounded-lg p-2 transition-colors hover:bg-slate-800 hover:text-slate-100",
          open ? "text-emerald-300" : "text-slate-500"
        )}
      >
        <Bell className="h-4 w-4" />
        {badge > 0 && (
          <span
            className={cn(
              "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white",
              badge > 9 && "text-[9px]"
            )}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: "min(360px, calc(100vw - 24px))" }}
            className="fixed z-[95] flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/98 shadow-2xl shadow-black/60 backdrop-blur-md"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Active alerts · warnings
              </span>
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-300">
                {badge}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">No active alerts.</p>
              )}
              {items.map((a) => {
                const srv = serverMap[a.server_id];
                const site = srv ? siteMap[srv.site_id] : undefined;
                const where =
                  [srv?.name ?? srv?.hostname, site?.client, site?.location]
                    .filter(Boolean)
                    .join(" · ") || a.server_id.slice(0, 8);
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      setOpen(false);
                      navigate(`/servers/${a.server_id}`);
                    }}
                    className="flex w-full items-start gap-2.5 border-b border-slate-800/70 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-slate-800/60"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        SEV_DOT[a.severity] ?? SEV_DOT.info
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-200">{a.message}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {[TYPE_LABEL[a.type] ?? a.type, where]
                          .filter(Boolean)
                          .join(" · ")}
                        {" · "}
                        {new Date(a.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                setOpen(false);
                navigate("/alerts");
              }}
              className="border-t border-slate-800 px-3 py-2 text-center text-xs font-medium text-sky-300 transition-colors hover:bg-slate-800/60"
            >
              View all slave logs
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
