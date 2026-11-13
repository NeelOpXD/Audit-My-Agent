import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const {
    signInWithGoogle,
    signInWithDirectGoogle,
    authError,
    isSigningIn,
    canUseDirectOAuth,
  } = useAuth();

  return (
    <div className="min-h-screen bg-[#0B0D12] text-slate-100 flex items-center justify-center px-6">
      <div className="w-full max-w-md border border-[#242B3D] bg-[#121620] rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-violet-600/15 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Audit-My-Agent
            </h1>
            <p className="text-xs text-slate-400">Test. Break. Measure. Improve.</p>
          </div>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-6">
          Independent AI agent reliability, adversarial red-teaming, execution trace diagnostics,
          and reproducible model benchmarking.
        </p>

        <div className="border-t border-[#242B3D] pt-6 space-y-4">
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => void signInWithGoogle()}
            className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
          >
            {isSigningIn && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
          </button>

          {canUseDirectOAuth && (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={() => void signInWithDirectGoogle()}
              className="w-full py-2.5 px-4 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60 disabled:cursor-not-allowed text-cyan-300 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              Continue with Direct Google OAuth
            </button>
          )}

          {authError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          <p className="text-xs text-slate-500 leading-relaxed">
            Registered agent credentials are encrypted at rest and never exposed in client bundles
            or API responses.
          </p>
        </div>
      </div>
    </div>
  );
}
