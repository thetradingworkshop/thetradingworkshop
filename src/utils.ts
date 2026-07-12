import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
