import { Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled
      className={cn(
        "h-8 w-8 transition-colors rounded-xl border border-slate-700/60 bg-slate-950/60 text-slate-300 opacity-80 cursor-not-allowed",
        className
      )}
      title="Active Theme: Obsidian Dark (TUI theme disabled)"
    >
      <Moon className="h-4 w-4 text-slate-300 transition-all duration-200" />
    </Button>
  );
}
