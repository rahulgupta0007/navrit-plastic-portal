"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type BusinessMode = "PET" | "PLASTIC";

type BusinessModeContextValue = {
  mode: BusinessMode;
  setMode: (mode: BusinessMode) => void;
};

const BusinessModeContext = createContext<BusinessModeContextValue | null>(null);
const STORAGE_KEY = "navrit-business-mode";

export function BusinessModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<BusinessMode>("PET");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "PET" || saved === "PLASTIC") setModeState(saved);
    setReady(true);
  }, []);

  const setMode = useCallback((next: BusinessMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  if (!ready) return null;
  return <BusinessModeContext.Provider value={value}>{children}</BusinessModeContext.Provider>;
}

export function useBusinessMode() {
  const context = useContext(BusinessModeContext);
  if (!context) throw new Error("useBusinessMode must be used within BusinessModeProvider");
  return context;
}
