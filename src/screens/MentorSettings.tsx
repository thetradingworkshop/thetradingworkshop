import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Toast } from '../components/Shared';
import { UserCheck, Users } from 'lucide-react';

// Self-service mentor pickup — "add a mentor later in their journey"
// (referred/invited Students land with no mentor at all; an Admin can
// still assign one from Users & Permissions, but this is the student's own
// path to it). Writing users/{uid}.mentorId directly here is what
// actually grants a Mentor account read access to this student's trades
// and journals (see firestore.rules' isAssignedMentor()) — same real
// grant as the Admin-side assignment, just initiated by the student
// themselves. firestore.rules' isValidMentorSelfAssign() is what actually
// enforces the target has to be a real Mentor-role account; this screen
// only decides what to *offer*.
interface MentorOption {
  id: string;
  name: string;
  email: string;
}

export default function MentorSettings() {
  const { user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [currentMentorId, setCurrentMentorId] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'Mentor')),
      (snapshot) => {
        setMentors(snapshot.docs.map(d => {
          const data: any = d.data();
          return { id: d.id, name: data.name || data.email || 'Unnamed mentor', email: data.email || '' };
        }));
      },
      (err) => console.error('mentors listener error:', err)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setIsLoading(false); return; }
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const mentorId = snap.data()?.mentorId || null;
        setCurrentMentorId(mentorId);
        setSelected(mentorId || '');
        setIsLoading(false);
      },
      () => setIsLoading(false)
    );
    return () => unsubscribe();
  }, [user?.uid]);

  const currentMentor = mentors.find(m => m.id === currentMentorId);

  const handleAssign = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { mentorId: selected || null });
      showToast(selected ? `Mentor set — they can now see your trades and journal.` : 'Mentor removed.');
    } catch (err: any) {
      showToast(`Failed to update mentor: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <h3 className="text-lg font-bold mb-2 flex items-center gap-2"><UserCheck className="w-4 h-4 text-primary" /> Your Mentor</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Pick a mentor whenever you're ready — no rush. Once set, they can see your trades and journal to help coach
          you; nothing else changes about your own access. You can switch or remove your mentor here any time.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mentors.length === 0 ? (
          <div className="flex items-center gap-3 p-4 bg-accent/20 rounded-xl">
            <Users className="w-5 h-5 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">No mentors are set up on this platform yet — check back later.</p>
          </div>
        ) : (
          <>
            {currentMentor && (
              <div className="flex items-center gap-3 p-4 mb-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-sm shrink-0">
                  {currentMentor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold">{currentMentor.name}</p>
                  <p className="text-[11px] text-muted-foreground">Currently your mentor</p>
                </div>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="flex-1 bg-accent/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">No mentor</option>
                {mentors.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <Button variant="primary" disabled={isSaving || selected === (currentMentorId || '')} onClick={handleAssign}>
                {isSaving ? 'Saving…' : currentMentorId ? 'Update Mentor' : 'Set Mentor'}
              </Button>
            </div>
          </>
        )}
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
