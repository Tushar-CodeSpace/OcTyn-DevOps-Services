import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "tui" | "dark" | "light" | "cyberpunk" | "emerald";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("user_theme") as Theme;
    return saved || "tui";
  });

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("user_theme", newTheme);
  };

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "tui" ? "dark" : theme === "dark" ? "light" : "tui";
    setTheme(nextTheme);
  };

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove("tui-theme", "dark", "light", "cyberpunk", "emerald");
    body.classList.remove("tui-theme", "dark", "light", "cyberpunk", "emerald");

    if (theme === "tui") {
      root.classList.add("tui-theme", "dark");
      body.classList.add("tui-theme", "dark");
    } else if (theme === "light") {
      root.classList.add("light");
      body.classList.add("light");
    } else if (theme === "cyberpunk") {
      root.classList.add("cyberpunk", "dark");
      body.classList.add("cyberpunk", "dark");
    } else if (theme === "emerald") {
      root.classList.add("emerald", "dark");
      body.classList.add("emerald", "dark");
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
