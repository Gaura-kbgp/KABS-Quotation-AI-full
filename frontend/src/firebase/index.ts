'use client';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { firebaseConfig } from './config';

export function initializeFirebase() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const db = getFirestore(app);
  const auth = getAuth(app);
  const storage = getStorage(app);
  return { app, db, auth, storage };
}

export * from './provider';
export { FirebaseClientProvider } from './client-provider';
export { useDoc } from './firestore/use-doc';
export { useCollection } from './firestore/use-collection';
export { useUser } from './auth/use-user';
export { useMemoFirebase } from './use-memo-firebase';
