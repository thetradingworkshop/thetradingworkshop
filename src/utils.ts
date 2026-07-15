import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The Firestore client SDK (unlike the Admin SDK) rejects `undefined` field
 * values outright, so any object with an unset optional field — e.g. a form
 * draft's default state — needs this before being handed to setDoc/addDoc.
 */
export function omitUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Maps a trade grade to a Badge variant so the full A+ through F scale
 * reads correctly (previously only A+ was "positive" and everything else,
 * including B and C, rendered as "negative").
 */
export function gradeBadgeVariant(grade?: string | null): 'positive' | 'info' | 'warning' | 'negative' | 'neutral' {
  switch (grade) {
    case 'A+':
    case 'A':
      return 'positive';
    case 'B':
      return 'info';
    case 'C':
      return 'warning';
    case 'D':
    case 'F':
      return 'negative';
    default:
      return 'neutral';
  }
}
