import { Flame, Moon, Sun, Terminal } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  const themeNames: Record<string, string> = {
    tui: "Amber CRT (TUI)",
    dark: "Obsidian Dark",
    "nido-dark": "Nido Dark Theme (Orange)",
    "nido-light": "Nido Theme Light (Orange)",
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className={cn(
        "h-8 w-8 transition-colors rounded-xl border border-slate-700/60 bg-slate-950/60 hover:bg-slate-800 hover:border-slate-600",
        theme === "tui"
          ? "border-amber-500/50 text-amber-400 bg-amber-950/40 hover:bg-amber-900/50"
          : theme === "nido-light"
          ? "border-orange-400/80 bg-orange-100 text-orange-600 hover:bg-orange-200"
          : theme === "nido-dark"
          ? "border-orange-600/70 text-orange-400 bg-stone-900 hover:bg-stone-800"
          : "text-slate-300 hover:text-slate-100",
        className
      )}
      title={`Active Theme: ${themeNames[theme] || theme} (Click to toggle)`}
    >
      {theme === "tui" ? (
        <Terminal className="h-4 w-4 text-amber-400 transition-all duration-200" />
      ) : theme === "nido-light" ? (
        <Sun className="h-4 w-4 text-orange-600 transition-all duration-200" />
      ) : theme === "nido-dark" ? (
        <Flame className="h-4 w-4 text-orange-400 transition-all duration-200" />
      ) : (
        <Moon className="h-4 w-4 text-slate-300 transition-all duration-200" />
      )}
    </Button>
  );
}
