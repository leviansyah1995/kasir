import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseAuthDomain = process.env.NODE_ENV === "production"
  ? "leviankitchen.pages.dev"
  : process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "realtime-database-11f5b.firebaseapp.com";

const firebaseConfig = {
  apiKey: "AIzaSyBmhKCv64j6UugxMEFgYidSi68YH70illg",
  authDomain: "realtime-database-11f5b.firebaseapp.com",
  databaseURL: "https://realtime-database-11f5b-default-rtdb.firebaseio.com",
  projectId: "realtime-database-11f5b",
  storageBucket: "realtime-database-11f5b.firebasestorage.app",
  messagingSenderId: "586970980086",
  appId: "1:586970980086:web:38d30545fbd89a3c4dd6d7",
  measurementId: "G-G9W58EBYM7"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);
const auth = getAuth(app);

export { app, db, auth };
