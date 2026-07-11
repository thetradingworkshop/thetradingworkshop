import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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
