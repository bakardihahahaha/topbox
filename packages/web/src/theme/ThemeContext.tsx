import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Same 3-theme pattern as Biosite KPI — user-picked, never OS-driven. "dim" is the default.
export type Theme = "dim" | "dark" | "light";

const THEME_STORAGE_KEY = "biosite-signoff.theme";
const ORDER: Theme[] = ["dim", "dark", "light"];
const LABELS: Record<Theme, string> = { dim: "Dim", dark: "Dark", light: "Light" };

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" || stored === "dim" ? stored : "dim";
  } catch {
    return "dim";
  }
}

function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // best-effort — a private window / blocked storage just means the choice doesn't persist
  }
}

interface ThemeContextValue {
  theme: Theme;
  themeLabel: string;
  cycleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => {
    function setTheme(next: Theme) {
      storeTheme(next);
      setThemeState(next);
    }
    return {
      theme,
      themeLabel: LABELS[theme],
      setTheme,
      cycleTheme: () => {
        const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
        setTheme(next);
      },
    };
  }, [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
