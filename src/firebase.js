import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

const isFirebaseConfigured = missingConfigKeys.length === 0;

if (!isFirebaseConfigured) {
  console.warn(
    `Firebase environment variables are missing: ${missingConfigKeys.join(", ")}`
  );
}

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

async function signInWithGoogle() {
  if (!auth) {
    throw new Error("Firebase is not configured. Create a local .env file from .env.example.");
  }

  return signInWithPopup(auth, googleProvider);
}

async function logOut() {
  if (!auth) {
    throw new Error("Firebase is not configured. Create a local .env file from .env.example.");
  }

  return signOut(auth);
}

export {
  app,
  auth,
  db,
  googleProvider,
  isFirebaseConfigured,
  missingConfigKeys,
  signInWithGoogle,
  logOut,
};
