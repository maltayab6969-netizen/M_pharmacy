import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setCsrfToken } from "@/lib/pharmacy-api";
import type { AuthState } from "@/lib/pharmacy-types";
import type { PharmacyUser } from "@/lib/pharmacy-api";

const PharmacyAuthContext = createContext<AuthState | null>(null);

type Status = { user: PharmacyUser | null; csrfToken: string; setupRequired: boolean };

export function PharmacyAuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PharmacyUser | null>(null);
  const [csrfToken, setToken] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const status = await api<Status>("/api/auth/status");
      setCsrfToken(status.csrfToken);
      setToken(status.csrfToken);
      setUser(status.user);
      setSetupRequired(status.setupRequired);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string, remember: boolean) => {
    const result = await api<{ user: PharmacyUser; csrfToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, remember }),
    });
    setCsrfToken(result.csrfToken);
    setToken(result.csrfToken);
    setUser(result.user);
    setSetupRequired(false);
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
    setToken("");
    setCsrfToken("");
    await refresh();
  };

  const value = useMemo<AuthState>(() => ({ loading, user, csrfToken, setupRequired, refresh, login, logout }), [loading, user, csrfToken, setupRequired]);
  return <PharmacyAuthContext.Provider value={value}>{children}</PharmacyAuthContext.Provider>;
}

export function usePharmacyAuth() {
  const value = useContext(PharmacyAuthContext);
  if (!value) throw new Error("usePharmacyAuth must be used within PharmacyAuthProvider");
  return value;
}
