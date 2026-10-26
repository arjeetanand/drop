'use client';

import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  inMemoryPersistence,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
  type UserCredential,
} from 'firebase/auth';
import { getFirebaseWebConfig, isFirebaseGoogleLoginEnabled } from './firebaseGoogleConfig';

export type FirebaseGoogleOAuthTokens = {
  idToken: string;
  accessToken?: string;
};

function getFirebaseAuth(): Auth {
  if (typeof window === 'undefined' || !isFirebaseGoogleLoginEnabled()) {
    throw new Error('Firebase Google sign-in is not configured.');
  }

  const app = getApps().find((existing) => existing.name === 'drop-auth')
    ?? initializeApp(getFirebaseWebConfig(), 'drop-auth');
  return getAuth(app);
}

function extractGoogleOAuthTokens(result: UserCredential): FirebaseGoogleOAuthTokens {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.idToken) {
    throw new Error('Google did not return an ID token.');
  }
  const tokens = {
    idToken: credential.idToken,
    ...(credential.accessToken ? { accessToken: credential.accessToken } : {}),
  };
  return tokens;
}

export async function signInWithFirebaseGooglePopup(): Promise<FirebaseGoogleOAuthTokens> {
  const auth = getFirebaseAuth();
  await setPersistence(auth, inMemoryPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    return extractGoogleOAuthTokens(result);
  } finally {
    // The token bridge needs Google's short-lived OAuth token, not a Firebase session.
    if (auth.currentUser) await signOut(auth);
  }
}
