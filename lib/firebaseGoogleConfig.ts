export type FirebaseWebConfig = {
  apiKey: string | undefined;
  authDomain: string | undefined;
  projectId: string | undefined;
  appId: string | undefined;
};

export function getFirebaseWebConfig(): FirebaseWebConfig {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export function isFirebaseGoogleLoginEnabled() {
  return process.env.NEXT_PUBLIC_FIREBASE_GOOGLE_LOGIN_ENABLED === 'true'
    && Object.values(getFirebaseWebConfig()).every((value) => Boolean(value));
}

export function isFirebasePopupBlockedError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'auth/popup-blocked';
}
