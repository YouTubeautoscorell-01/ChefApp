
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDi40oL-JtE9LXF8CPGFHHLL6Hqe4p_GDA",
  authDomain: "restaurant-63230.firebaseapp.com",
  projectId: "restaurant-63230",
  storageBucket: "restaurant-63230.firebasestorage.app",
  messagingSenderId: "624519670365",
  appId: "1:624519670365:web:f23d10079a9adf2c51bbb4"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
  db,
  collection,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
};
