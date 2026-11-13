import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

interface FirebaseAppletConfig {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
}

const localConfigModules = import.meta.glob('../../firebase-applet-config.json', {
  eager: true,
}) as Record<string, { default?: FirebaseAppletConfig } & FirebaseAppletConfig>;

const firstModule = Object.values(localConfigModules)[0];
const fileConfig: FirebaseAppletConfig = firstModule?.default ?? firstModule ?? {};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fileConfig.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fileConfig.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || fileConfig.projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fileConfig.storageBucket || '',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fileConfig.messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fileConfig.appId || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || fileConfig.measurementId || '',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
export const firebaseOAuthClientId =
  import.meta.env.VITE_FIREBASE_OAUTH_CLIENT_ID || fileConfig.oAuthClientId || '';
