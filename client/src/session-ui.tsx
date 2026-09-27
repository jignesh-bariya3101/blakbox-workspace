import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const SessionUi = createContext<{
  forceGuest: boolean;
  setForceGuest: (value: boolean) => void;
}>({
  forceGuest: false,
  setForceGuest: () => undefined,
});

export function SessionUiProvider({ children }: { children: ReactNode }) {
  const [forceGuest, setForceGuest] = useState(false);
  const value = useMemo(() => ({ forceGuest, setForceGuest }), [forceGuest]);
  return <SessionUi.Provider value={value}>{children}</SessionUi.Provider>;
}

export function useSessionUi() {
  return useContext(SessionUi);
}
