import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

// Ganti nilai di bawah ini dengan config dari Firebase Console Anda nanti
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

// Initialize Firebase (Mencegah inisialisasi ganda di Next.js)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Inisialisasi Realtime Database dan Auth
export const db = getDatabase(app);
export const auth = getAuth(app);