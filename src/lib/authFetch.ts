import { auth } from '../firebase';

// Every /api/* route that touches a specific user's data or costs real
// money (Anthropic calls) now verifies a real Firebase ID token server-side
// (see server.ts's requireAuth) instead of trusting whatever userId/
// x-user-id the client happened to send — which used to let any request
// act as any user. This is the client half: attach the signed-in user's
// actual ID token as a Bearer token on every such call, in one place,
// rather than repeating the getIdToken() dance at each call site.
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in.');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}
