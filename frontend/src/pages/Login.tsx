import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Lock, Mail } from "lucide-react";
import { login } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const navigate = useNavigate();
  const { reload } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      await reload();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 selection:bg-emerald-500/30">
      {/* Background ambient radial meshes */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[50rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]"></div>
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-[30rem] rounded-full bg-sky-500/10 blur-[100px]"></div>
      <div className="pointer-events-none absolute top-1/2 left-0 h-80 w-80 -translate-y-1/2 rounded-full bg-indigo-500/10 blur-[100px]"></div>

      <div className="relative w-full max-w-md">
        {/* Brand logo & tagline */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <span className="absolute inset-0 rounded-2xl bg-emerald-500/50 blur-xl"></span>
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/40 bg-slate-900/90 shadow-xl shadow-emerald-500/20 backdrop-blur-xl">
              <Activity className="h-8 w-8 text-emerald-400" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              OcTyn <span className="text-gradient-emerald">DevOps Services</span>
            </h1>
            <p className="mt-1 text-xs font-medium text-slate-400">
              Central Monitoring & Site Infrastructure Hub
            </p>
          </div>
        </div>

        {/* Login glass card */}
        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl shadow-black/60 backdrop-blur-2xl">
          <div className="mb-6 flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-100">Welcome Back</h2>
              <p className="text-xs text-slate-400">Enter your credentials to access the console</p>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
              v2.5 Live
            </span>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-xs font-semibold text-slate-300">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  required
                  className="h-11 border-slate-800 bg-slate-950/60 pl-10 text-xs text-slate-100 outline-none transition-all placeholder:text-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-xs font-semibold text-slate-300">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="password"
                  type="password"
                  required
                  className="h-11 border-slate-800 bg-slate-950/60 pl-10 text-xs text-slate-100 outline-none transition-all placeholder:text-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/15 p-3 text-xs text-red-300 shadow-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-11 w-full rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:from-emerald-400 hover:to-cyan-400 active:scale-95 disabled:opacity-50"
            >
              {loading ? "Authenticating…" : "Sign In to Console"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}