import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "tui" | "dark" | "nido-light" | "nido-dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("user_theme") as Theme;
    return ["tui", "dark", "nido-light", "nido-dark"].includes(saved) ? saved : "tui";
  });

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("user_theme", newTheme);
  };

  const toggleTheme = () => {
    const order: Theme[] = ["tui", "dark", "nido-dark", "nido-light"];
    const idx = order.indexOf(theme);
    const nextTheme = order[(idx + 1) % order.length];
    setTheme(nextTheme);
  };

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove("tui-theme", "dark", "light", "nido-light", "nido-dark");
    body.classList.remove("tui-theme", "dark", "light", "nido-light", "nido-dark");

    if (theme === "tui") {
      root.classList.add("tui-theme", "dark");
      body.classList.add("tui-theme", "dark");
    } else if (theme === "nido-light") {
      root.classList.add("nido-light", "light");
      body.classList.add("nido-light", "light");
    } else if (theme === "nido-dark") {
      root.classList.add("nido-dark", "dark");
      body.classList.add("nido-dark", "dark");
    } else {
      root.classList.add("dark");
      body.classList.add("dark");
    }

    localStorage.setItem("user_theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
