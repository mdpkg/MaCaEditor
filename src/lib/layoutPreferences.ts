import { useEffect, useState } from "react";

export function useStoredLayoutNumber(key: string, initial: number, min: number, max: number) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      const parsed = stored === null ? initial : Number(stored);
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : initial;
    } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, String(value)); } catch { /* Layout remains usable without storage. */ } }, [key, value]);
  return [value, setValue] as const;
}
