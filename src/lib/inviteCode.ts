// Shared by Users & Permissions' "Generate Invite" (UsersPermissionsScreen.tsx)
// and Settings' personal referral link (SettingsScreen.tsx) — both create
// docs in the same `invites` collection, keyed by this code.

// No 0/1/i/l/o — avoids visual ambiguity when a code is read aloud or typed
// in by hand.
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

// 10 chars from a 32-symbol alphabet is ~50 bits of entropy, ample for a
// bearer token handed out directly rather than one exposed to brute-force
// guessing (see firestore.rules: `list`ing all invites is Admin-only, so
// guessing is the only other way to find one that isn't yours).
export function generateInviteCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
