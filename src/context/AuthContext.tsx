import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, firebaseOAuthClientId, googleAuthProvider } from '../lib/firebase';

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisError {
  type?: string;
  message?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleIdentityGlobal {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: GisTokenResponse) => void;
        error_callback?: (error: GisError) => void;
      }) => GisTokenClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityGlobal;
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let gisLoadPromise: Promise<boolean> | null = null;

function ensureGisLoaded(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve(true);
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.google?.accounts?.oauth2)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.google?.accounts?.oauth2?.initTokenClient));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

const FALLBACK_TRIGGER_CODES = new Set([
  'auth/error-code:-40',
  'auth/internal-error',
  'auth/web-storage-unsupported',
  'auth/operation-not-supported-in-this-environment',
  'auth/unauthorized-domain',
  'auth/popup-blocked',
  'auth/network-request-failed',
]);

const AUTO_FALLBACK_CODES = new Set([
  'auth/error-code:-40',
  'auth/internal-error',
  'auth/web-storage-unsupported',
  'auth/operation-not-supported-in-this-environment',
]);

function extractFirebaseCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function formatAuthErrorMessage(err: unknown): string {
  const code = extractFirebaseCode(err);
  switch (code) {
    case 'auth/error-code:-40':
      return 'Firebase popup OAuth handler returned auth/error-code:-40. Use Direct Google OAuth below to complete sign-in.';
    case 'auth/popup-blocked':
      return 'The browser blocked the sign-in popup. Allow popups for this site or use Direct Google OAuth below.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing authentication.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in request was superseded. Please click Sign in with Google again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for the Firebase popup handler. Use Direct Google OAuth below.';
    case 'auth/internal-error':
    case 'auth/web-storage-unsupported':
    case 'auth/operation-not-supported-in-this-environment':
      return 'Embedded browser storage or popup constraints blocked the Firebase auth handler. Use Direct Google OAuth below.';
    default:
      return err instanceof Error ? err.message : 'Sign-in failed';
  }
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  canUseDirectOAuth: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithDirectGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [canUseDirectOAuth, setCanUseDirectOAuth] = useState(false);
  const signingInRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
      if (nextUser) {
        setAuthError(null);
        setCanUseDirectOAuth(false);
        signingInRef.current = false;
        setIsSigningIn(false);
      }
    });
    if (firebaseOAuthClientId) {
      void ensureGisLoaded();
    }
    return () => unsub();
  }, []);

  const runDirectGisFlow = (suppressPopupBlockedError = false): Promise<boolean> => {
    const initTokenClient = window.google?.accounts?.oauth2?.initTokenClient;
    if (!firebaseOAuthClientId || !initTokenClient) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const client = initTokenClient({
        client_id: firebaseOAuthClientId,
        scope: 'openid email profile',
        callback: async (tokenResponse) => {
          if (tokenResponse.error || !tokenResponse.access_token) {
            const detail = tokenResponse.error_description || tokenResponse.error || 'OAuth authorization failed';
            setAuthError(`Google OAuth error: ${detail}`);
            signingInRef.current = false;
            setIsSigningIn(false);
            resolve(false);
            return;
          }

          try {
            const credential = GoogleAuthProvider.credential(null, tokenResponse.access_token);
            await signInWithCredential(auth, credential);
            setAuthError(null);
            setCanUseDirectOAuth(false);
            resolve(true);
          } catch (credErr) {
            const code = extractFirebaseCode(credErr);
            console.error('[Auth] Direct Google credential exchange failed:', {
              code: code || 'unknown',
              message: credErr instanceof Error ? credErr.message : String(credErr),
            });
            setAuthError(formatAuthErrorMessage(credErr));
            resolve(false);
          } finally {
            signingInRef.current = false;
            setIsSigningIn(false);
          }
        },
        error_callback: (gisErr) => {
          const errType = gisErr?.type || 'unknown';
          if (errType === 'popup_failed_to_open') {
            if (!suppressPopupBlockedError) {
              setAuthError('Popup was blocked by the browser. Click "Continue with Direct Google OAuth" again to open sign-in.');
            }
            setCanUseDirectOAuth(true);
          } else if (errType === 'popup_closed') {
            if (!suppressPopupBlockedError) {
              setAuthError('Google sign-in window was closed before completing.');
            }
          } else {
            setAuthError(gisErr?.message || 'Google OAuth popup failed.');
          }
          signingInRef.current = false;
          setIsSigningIn(false);
          resolve(false);
        },
      });

      try {
        client.requestAccessToken({ prompt: 'select_account' });
      } catch (reqErr) {
        console.error('[Auth] GIS requestAccessToken failed:', reqErr);
        signingInRef.current = false;
        setIsSigningIn(false);
        resolve(false);
      }
    });
  };

  const signInWithDirectGoogle = async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setIsSigningIn(true);
    setAuthError(null);

    const isReadySync = Boolean(window.google?.accounts?.oauth2?.initTokenClient);
    if (!isReadySync) {
      const loaded = await ensureGisLoaded();
      if (!loaded) {
        setAuthError('Unable to load Google Identity Services client.');
        signingInRef.current = false;
        setIsSigningIn(false);
        return;
      }
    }

    await runDirectGisFlow(false);
  };

  const signInWithGoogle = async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setIsSigningIn(true);
    setAuthError(null);

    const startedAt = Date.now();
    try {
      await signInWithPopup(auth, googleAuthProvider);
      setCanUseDirectOAuth(false);
    } catch (err) {
      const code = extractFirebaseCode(err);
      const elapsedMs = Date.now() - startedAt;
      console.error('[Auth] Google popup sign-in failed:', {
        code: code || 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });

      const supportsFallback = Boolean(firebaseOAuthClientId) && FALLBACK_TRIGGER_CODES.has(code);
      if (supportsFallback) {
        setCanUseDirectOAuth(true);
      }

      if (
        firebaseOAuthClientId &&
        AUTO_FALLBACK_CODES.has(code) &&
        elapsedMs < 2500 &&
        window.google?.accounts?.oauth2?.initTokenClient
      ) {
        const succeeded = await runDirectGisFlow(true);
        if (succeeded) {
          return;
        }
      }

      setAuthError(formatAuthErrorMessage(err));
    } finally {
      signingInRef.current = false;
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const getToken = async () => {
    if (!auth.currentUser) {
      throw new Error('Authentication required');
    }
    return auth.currentUser.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSigningIn,
        authError,
        canUseDirectOAuth,
        signInWithGoogle,
        signInWithDirectGoogle,
        logout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
