'use client';

import React, { useEffect, useState } from 'react';
import { initializeFirebase } from './index';
import { FirebaseProvider } from './provider';

export function FirebaseClientProvider({ children }: { children: React.ReactNode }) {
  const [instances, setInstances] = useState<ReturnType<typeof initializeFirebase> | null>(null);

  useEffect(() => {
    setInstances(initializeFirebase());
  }, []);

  if (!instances) return null;

  return (
    <FirebaseProvider 
      app={instances.app} 
      db={instances.db} 
      auth={instances.auth}
      storage={instances.storage}
    >
      {children}
    </FirebaseProvider>
  );
}
