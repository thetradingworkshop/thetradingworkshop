import { authFetch } from './authFetch';

// Settings → Security → "Sign out of all devices". Server-side call (Admin
// SDK's revokeRefreshTokens, see server.ts) since a client can't revoke
// another device's session itself. Only invalidates refresh tokens — an
// already-issued ID token elsewhere stays valid until its natural ~1hr
// expiry, a Firebase Auth limit this can't shorten.
export async function revokeAllSessions(): Promise<void> {
  const response = await authFetch('/api/account/revoke-sessions', { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
}
