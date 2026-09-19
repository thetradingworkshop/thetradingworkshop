import { Smile, Meh, Frown, Angry, Focus } from 'lucide-react';
import { JournalEntry } from '../types';

// Edgewonk-style psychology tracking — a single mood tag per journal note,
// aggregated (Reports -> Psychology) against that note's linked trade/
// session P&L to see which emotional states actually correlate with
// performance. Shared between JournalScreen (where mood is set) and
// ReportsScreen (where it's analyzed) so both read the same label/icon/order.
export type Mood = NonNullable<JournalEntry['mood']>;

export const MOOD_OPTIONS: { value: Mood; label: string; icon: any }[] = [
  { value: 'focused', label: 'Focused', icon: Focus },
  { value: 'happy', label: 'Happy', icon: Smile },
  { value: 'neutral', label: 'Neutral', icon: Meh },
  { value: 'frustrated', label: 'Frustrated', icon: Frown },
  { value: 'angry', label: 'Angry', icon: Angry },
];

export const MOOD_LABEL: Record<string, string> = Object.fromEntries(MOOD_OPTIONS.map(m => [m.value, m.label]));
export const MOOD_ORDER: string[] = MOOD_OPTIONS.map(m => m.label);
