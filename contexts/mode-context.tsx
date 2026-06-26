"use client";

import * as React from "react";

type Mode = "buying" | "selling";

interface ModeContextValue {
  mode: Mode;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  isDualRole: boolean;
  setIsDualRole: (val: boolean) => void;
}

const ModeContext = React.createContext<ModeContextValue>({
  mode: "buying",
  toggleMode: () => {},
  setMode: () => {},
  isDualRole: false,
  setIsDualRole: () => {},
});

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<Mode>("buying");
  const [isDualRole, setIsDualRole] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem("qevira-mode");
    if (stored === "buying" || stored === "selling") {
      setModeState(stored);
    }
    setHydrated(true);
  }, []);

  const setMode = React.useCallback((newMode: Mode) => {
    setModeState(newMode);
    localStorage.setItem("qevira-mode", newMode);
  }, []);

  const toggleMode = React.useCallback(() => {
    setModeState((prev) => {
      const newMode = prev === "buying" ? "selling" : "buying";
      localStorage.setItem("qevira-mode", newMode);
      return newMode;
    });
  }, []);

  const value = React.useMemo(
    () => ({
      mode,
      toggleMode,
      setMode,
      isDualRole,
      setIsDualRole,
    }),
    [mode, toggleMode, setMode, isDualRole]
  );

  if (!hydrated) return null;

  return (
    <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
  );
}

export function useMode() {
  return React.useContext(ModeContext);
}
