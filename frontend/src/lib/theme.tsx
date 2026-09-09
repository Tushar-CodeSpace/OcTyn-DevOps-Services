import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "tui" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("user_theme") as Theme;
    return ["tui", "dark"].includes(saved) ? saved : "tui";
  });

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("user_theme", newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === "tui" ? "dark" : "tui");
  };

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove("tui-theme", "dark", "light", "nido-light", "nido-dark");
    body.classList.remove("tui-theme", "dark", "light", "nido-light", "nido-dark");

    if (theme === "tui") {
      root.classList.add("tui-theme", "dark");
      body.classList.add("tui-theme", "dark");
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
