import { useState, Dispatch, SetStateAction } from 'react';

// Persists a small display preference (e.g. a chart's bar/line toggle, a
// section's collapsed/expanded state) to localStorage so it's remembered
// across reloads — a per-browser UI convenience, not real user data, so it
// deliberately doesn't sync through Firestore. JSON-serialized so any
// serializable value works (string, boolean, etc.), not just strings.
// Wrapped in try/catch since localStorage can throw (private browsing,
// blocked storage) and JSON.parse can throw on a corrupted/foreign value.
// Same setter contract as useState (accepts either a value or an updater
// function), so a call site can freely use `setX(prev => !prev)`.
export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `pref:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setPersistedValue: Dispatch<SetStateAction<T>> = (next) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      try {
        localStorage.setItem(storageKey, JSON.stringify(resolved));
      } catch {
        // private browsing / storage blocked — preference just won't persist
      }
      return resolved;
    });
  };

  return [value, setPersistedValue];
}
