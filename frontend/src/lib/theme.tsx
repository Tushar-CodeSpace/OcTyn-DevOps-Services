import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "tui" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  const setTheme = (newTheme: Theme) => {
    // TUI disabled for now; force Obsidian Dark ("dark")
    const activeTheme = newTheme === "dark" ? "dark" : "dark";
    setThemeState(activeTheme);
    localStorage.setItem("user_theme", activeTheme);
  };

  const toggleTheme = () => {
    // Single active theme: Obsidian Dark
    setTheme("dark");
  };

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove("tui-theme", "light", "nido-light", "nido-dark");
    body.classList.remove("tui-theme", "light", "nido-light", "nido-dark");

    root.classList.add("dark");
    body.classList.add("dark");

    localStorage.setItem("user_theme", "dark");
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
