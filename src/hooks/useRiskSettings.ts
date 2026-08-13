import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { RiskSettings } from '../types';
import { useAuth } from '../context/AuthContext';

// Live view of users/{uid}.riskSettings — Settings → Risk Parameters is
// still the one-time-load/explicit-save editor (no reason for that form to
// re-render mid-edit), but anything just *reading* the current targets
// (Dashboard's Goals card today, maybe Mentor Dashboard later) wants it to
// update automatically the moment a user saves a change in Settings,
// without needing a manual refresh.
export function useRiskSettings(): { riskSettings: RiskSettings; isLoading: boolean } {
  const { user } = useAuth();
  const [riskSettings, setRiskSettings] = useState<RiskSettings>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) { setRiskSettings({}); setIsLoading(false); return; }
    setIsLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => { setRiskSettings(snap.data()?.riskSettings || {}); setIsLoading(false); },
      (err) => { console.error('riskSettings listener error:', err); setIsLoading(false); }
    );
    return () => unsubscribe();
  }, [user?.uid]);

  return { riskSettings, isLoading };
}
