/**
 * /login — Real JWT login with role-based redirect.
 *
 * After successful login redirects to:
 *   DRIVER         → /driver
 *   POLICE         → /police
 *   HOSPITAL_ADMIN → /hospital
 */

import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ROLE_HOME } from "../components/ProtectedRoute";

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  // Redirect once user is known
  useEffect(() => {
    if (!loading && user) {
      const intended = (location.state as LocationState)?.from?.pathname;
      const dest = intended ?? ROLE_HOME[user.role];
      navigate(dest, { replace: true });
    }
  }, [user, loading, navigate, location.state]);

  // While restoring session, show spinner
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="animate-spin text-5xl">🚑</span>
      </div>
    );
  }

  // Already logged in — useEffect will redirect, but guard against flash
  if (user) {
    const intended = (location.state as LocationState)?.from?.pathname;
    return <Navigate to={intended ?? ROLE_HOME[user.role]} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      // useEffect above will redirect after user state updates
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Invalid username or password";
      setError(msg);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">

        {/* ── Brand ─────────────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-egc-green-600 mb-4 shadow-lg shadow-egc-green-900/50">
            <span className="text-3xl" role="img" aria-label="ambulance">🚑</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Emergency Green Corridor</h1>
          <p className="text-gray-400 text-sm mt-1">Real-time emergency corridor management</p>
        </div>

        {/* ── Login card ────────────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in</h2>

          <form onSubmit={handleSubmit} noValidate>

            {/* Error banner */}
            {error && (
              <div
                role="alert"
                className="mb-4 bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3"
              >
                {error}
              </div>
            )}

            {/* Username */}
            <div className="mb-4">
              <label htmlFor="login-username" className="block text-sm text-gray-400 mb-1">
                Username
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                placeholder="e.g. driver1"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 focus:border-transparent disabled:opacity-50 transition-colors"
              />
            </div>

            {/* Password */}
            <div className="mb-6">
              <label htmlFor="login-password" className="block text-sm text-gray-400 mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 focus:border-transparent disabled:opacity-50 transition-colors"
              />
            </div>

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              disabled={busy || !username.trim() || !password.trim()}
              className="w-full bg-egc-green-600 hover:bg-egc-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* Demo credentials hint */}
          <div className="mt-6 border-t border-gray-800 pt-5">
            <p className="text-xs text-gray-600 text-center mb-3">Demo accounts (run seed first)</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { username: "driver1",  password: "Driver@123",  label: "Driver"   },
                { username: "police1",  password: "Police@123",  label: "Police"   },
                { username: "admin_h1", password: "Admin@123",   label: "Hospital" },
              ].map(({ username: u, password: p, label }) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => { setUsername(u); setPassword(p); setError(null); }}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-2 py-2 transition-colors text-left"
                >
                  <span className="block text-xs font-semibold text-gray-300">{label}</span>
                  <span className="block text-xs text-gray-500 font-mono">{u}</span>
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-gray-700 mt-3">
              Click a card to autofill credentials
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
