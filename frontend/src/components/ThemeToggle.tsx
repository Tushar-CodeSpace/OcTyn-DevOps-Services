import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className={cn(
        "h-8 w-8 transition-colors rounded-xl border border-slate-700/60 bg-slate-950/60 hover:bg-slate-800 hover:border-slate-600",
        theme === "tui"
          ? "border-amber-500/50 text-amber-400 bg-amber-950/40 hover:bg-amber-900/50"
          : theme === "light"
          ? "border-amber-300/80 bg-amber-50 text-amber-600 hover:bg-amber-100"
          : "text-emerald-400 hover:text-emerald-300",
        className
      )}
      title={`Active Theme: ${theme.toUpperCase()} (Click to toggle theme style)`}
    >
      {theme === "light" ? (
        <Sun className="h-4 w-4 text-amber-600 transition-all duration-200" />
      ) : (
        <Moon className="h-4 w-4 text-amber-400 transition-all duration-200" />
      )}
    </Button>
  );
}
