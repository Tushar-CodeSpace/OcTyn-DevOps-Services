import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  Crown,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeftClose,
  Search,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ToastHost } from "@/components/ToastHost";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ThemeToggle } from "@/components/ThemeToggle";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/alerts", label: "Alert logs", icon: Bell },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const adminNav = [
  { to: "/users", label: "Users & Roles", icon: Users },
  { to: "/audit-logs", label: "Audit logs", icon: History },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
];


function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="hidden font-mono text-xs tabular-nums text-slate-400 sm:block">
      {now.toLocaleTimeString([], { hour12: false })}
    </span>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { user, isAdmin, isSuperAdmin, logout } = useAuth();
  const location = useLocation();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
  );
  const expanded = pinned || hovered;
  // Inside the drawer (mobile) labels are always shown; desktop keeps rail/pin logic.
  const wide = expanded || isMobile;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) setMobileOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentNavItem = location.pathname.startsWith("/servers/")
    ? { label: "Server details", icon: Activity }
    : ([...nav, ...adminNav].find((n) => n.to === location.pathname) ?? {
        label: "Dashboard",
        icon: LayoutDashboard,
      });

  const PageIcon = currentNavItem.icon;
  const pageTitle = currentNavItem.label;

  return (
    <div className="flex min-h-screen">
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Mobile backdrop */}
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        onMouseEnter={() => !isMobile && setHovered(true)}
        onMouseLeave={() => !isMobile && setHovered(false)}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden shadow-2xl",
          isSuperAdmin
            ? "bg-black border-slate-800"
            : "bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-slate-800/80",
          "transition-[transform,width,box-shadow] duration-300 ease-in-out",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-[90] w-64",
                mobileOpen ? "translate-x-0 shadow-black/70" : "-translate-x-full"
              )
            : cn("fixed left-3 top-3 z-40 h-[calc(100vh-1.5rem)] rounded-2xl border", expanded ? "w-60 shadow-black/60" : "w-[4.75rem] shadow-black/40")
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex w-full shrink-0 items-center gap-2 px-4 pb-3 pt-5",
            !expanded && !isMobile && "justify-center px-0",
            isMobile && "pt-6"
          )}
        >
          <button
            className="relative shrink-0 cursor-pointer"
            title={expanded && !isMobile ? undefined : "Open menu"}
            onClick={() => {
              if (isMobile) {
                setMobileOpen(false);
              } else if (!expanded) {
                setPinned(true);
              }
              navigate("/");
            }}
          >
            <span className="absolute inset-0 rounded-lg bg-emerald-500/30 blur-md"></span>
            <Activity className="relative h-6 w-6 text-emerald-400" />
          </button>
          {wide && (
            <>
              <span className="flex-1 truncate whitespace-nowrap font-semibold tracking-tight">
                OcTyn <span className="text-emerald-400">DevOps</span>
              </span>
              {!isMobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-500 hover:text-slate-200"
                  onClick={() => setPinned(false)}
                  title="Collapse to hover rail"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>

        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent" />

        {/* Nav */}
        <nav className="mt-3 flex w-full flex-col items-center gap-1 px-2 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={label}
              onClick={() => isMobile && setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-2.5 rounded-xl py-2 text-sm text-slate-400 transition-all hover:bg-slate-800/70 hover:text-slate-100",
                  wide ? "w-full px-3" : "w-10 justify-center",
                  isActive &&
                    "bg-gradient-to-r from-emerald-500/15 to-transparent text-emerald-300 hover:text-emerald-300"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && wide && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"></span>
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors group-hover:text-emerald-400",
                      isActive && "text-emerald-400"
                    )}
                  />
                  {wide && <span className="whitespace-nowrap">{label}</span>}
                </>
              )}
            </NavLink>
          ))}

          {/* Admin Navigation Section */}
          {isAdmin && (
            <>
              <div className="my-1.5 w-full px-2">
                <div className="h-px bg-slate-800/80" />
                {wide && (
                  <span
                    className={cn(
                      "mt-2 block text-[10px] font-bold uppercase tracking-wider",
                      isSuperAdmin ? "text-amber-400 font-extrabold flex items-center gap-1" : "text-emerald-400/80"
                    )}
                  >
                    {isSuperAdmin && <Crown className="h-3 w-3 text-amber-400" />}
                    {isSuperAdmin ? "Super Admin Controls" : "Admin Controls"}
                  </span>
                )}
              </div>
              {adminNav.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={label}
                  onClick={() => isMobile && setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center gap-2.5 rounded-xl py-2 text-sm text-slate-400 transition-all hover:bg-slate-800/70 hover:text-slate-100",
                      wide ? "w-full px-3" : "w-10 justify-center",
                      isActive &&
                        "bg-gradient-to-r from-indigo-500/15 to-transparent text-indigo-300 hover:text-indigo-300"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && wide && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.9)]"></span>
                      )}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors group-hover:text-indigo-400",
                          isActive && "text-indigo-400"
                        )}
                      />
                      {wide && <span className="whitespace-nowrap">{label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="mb-4 mt-auto flex w-full flex-col items-center gap-1 px-2">
          <div className="mx-2 mb-2 h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent" />
          <Button
            variant="ghost"
            size={wide ? "sm" : "icon"}
            className={cn("text-slate-400", wide && "w-full justify-start")}
            onClick={() => {
              if (isMobile) setMobileOpen(false);
              logout();
              navigate("/login");
            }}
            title="Logout"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {wide && "Logout"}
          </Button>
        </div>
      </aside>

      {/* Desktop rail spacer (mobile uses the drawer) */}
      <div className={cn("hidden h-screen shrink-0 lg:block", pinned ? "w-[268px]" : "w-[116px]")} />

      <main className="flex min-w-0 flex-1 flex-col py-3 pr-3">
        {/* Top navbar header */}
        <header className={cn(
          "sticky top-0 z-30 mb-5 flex h-14 shrink-0 items-center gap-2 rounded-2xl border border-slate-800/80 px-3 shadow-lg shadow-black/30 backdrop-blur-xl sm:gap-3 sm:px-4",
          isSuperAdmin
            ? "bg-black border-slate-800"
            : "bg-gradient-to-r from-slate-900/90 via-slate-900/70 to-slate-900/40"
        )}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-300 hover:text-white lg:hidden"
            onClick={() => setMobileOpen(true)}
            title="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <div className="hidden h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 sm:flex">
              <PageIcon className="h-4 w-4 text-emerald-400" />
            </div>
            <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-100">
              {pageTitle}
            </h2>
          </div>

          {/* Quick Search trigger button — placed on LEFT right after page name */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-400 hover:border-emerald-500/40 hover:text-slate-200 transition-all cursor-pointer shadow-inner ml-2"
          >
            <Search className="h-3.5 w-3.5 text-emerald-400" />
            <span>Search site servers...</span>
            <kbd className="ml-2 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
              Ctrl+K
            </kbd>
          </button>

          {/* Right cluster */}
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              Live
            </span>
            <Clock />
            <div className="hidden h-6 w-px bg-slate-700/70 sm:block" />
            {user && (
              <div className="hidden min-w-0 items-center gap-2 sm:flex">
                <div className="flex flex-col items-end leading-tight">
                  <span className="max-w-[12rem] truncate text-xs font-semibold text-slate-200">{user.email}</span>
                  <span className="text-[10px] text-slate-400 font-medium">Monitoring User</span>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border backdrop-blur-md flex items-center gap-1 shadow-md transition-all",
                    isSuperAdmin
                      ? "border-amber-500/50 bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 shadow-amber-500/20"
                      : isAdmin
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "border-sky-500/40 bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                  )}
                >
                  {isSuperAdmin && <Crown className="h-3 w-3 text-amber-400 animate-pulse" />}
                  {isSuperAdmin ? "super_admin" : isAdmin ? "admin" : "viewer"}
                </span>
              </div>
            )}
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        {children}
      </main>
      <ToastHost />
    </div>
  );
}
