import { useState } from 'react';

// Persists a small display preference (e.g. a chart's bar/line toggle) to
// localStorage so it's remembered across reloads — a per-browser UI
// convenience, not real user data, so it deliberately doesn't sync through
// Firestore. Wrapped in try/catch since localStorage can throw (private
// browsing, blocked storage).
export function usePersistedState<T extends string>(key: string, defaultValue: T): [T, (value: T) => void] {
  const storageKey = `pref:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(storageKey) as T | null) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setPersistedValue = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // private browsing / storage blocked — preference just won't persist
    }
  };

  return [value, setPersistedValue];
}
