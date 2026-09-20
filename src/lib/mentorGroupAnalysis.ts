import { authFetch } from './authFetch';

// Mentor Dashboard's "Group Pattern Analysis" — the client side of
// POST /api/mentor/group-pattern-analysis (server.ts). The server never
// invents student stats; it only narrates the real, already-computed
// per-student metrics this module sends it.
export interface GroupPatternStudentInput {
  id: string;
  name: string;
  discipline: number;
  consistency: number;
  payoffRatioScore: number;
  entryTimingScore: number | null;
  sessionVerdict?: string;
  lossPatterns?: string[];
  timingInsight?: string[];
  keyPatterns?: string[];
}

export interface GroupPatternResult {
  insufficientData?: boolean;
  groupSummary?: string;
  commonStrengths?: string[];
  commonWeaknesses?: string[];
  recommendedFocus?: string;
}

export async function requestGroupPatternAnalysis(students: GroupPatternStudentInput[]): Promise<GroupPatternResult> {
  const response = await authFetch('/api/mentor/group-pattern-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ students }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
  return response.json();
}
