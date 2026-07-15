import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Local dev/testing only — never touches production. Opt in with
// VITE_USE_FIREBASE_EMULATOR=true (set by `npm run dev:emulated`), which
// points the client at the Firebase Local Emulator Suite instead of the
// real project, so local testing never reads/writes real user data.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  console.warn('[firebase] Connected to LOCAL EMULATORS (Auth + Firestore) — not production.');
}

// Validate Connection to Firestore
async function testConnection() {
  console.log("Testing Firestore connection with databaseId:", firebaseConfig.firestoreDatabaseId);
  try {
    const testDoc = await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection successful. Test doc exists:", testDoc.exists());
  } catch (error) {
    console.error("Firestore connection test failed:", error);
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is reporting as offline.");
    }
  }
}

testConnection();
