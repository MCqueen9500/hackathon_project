/**
 * /login — Real JWT login with role-based redirect.
 *
 * After successful login, redirects to:
 *   DRIVER         → /driver
 *   POLICE         → /police
 *   HOSPITAL_ADMIN → /hospital
 *
 * If already logged in (session restore), bypasses the form entirely.
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
  const navigate  = useNavigate();
  const location  = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  // If already authenticated, redirect immediately
  if (!loading && user) {
    const intended = (location.state as LocationState)?.from?.pathname;
    const dest     = intended ?? ROLE_HOME[user.role];
    return <Navigate to={dest} replace />;
  }

  // While restoring session, show spinner
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="animate-spin text-5xl">🚑</span>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      // login() sets user in AuthContext; useEffect below will redirect
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Invalid username or password";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Redirect after login sets user
  useEffect(() => {
    if (user) {
      const intended = (location.state as LocationState)?.from?.pathname;
      navigate(intended ?? ROLE_HOME[user.role], { replace: true });
    }
  }, [user, navigate, location.state]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">

        {/* ── Brand ────────────────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-egc-green-600 mb-4 shadow-lg shadow-egc-green-900/50">
            <span className="text-3xl" role="img" aria-label="ambulance">🚑</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Emergency Green Corridor</h1>
          <p className="text-gray-400 text-sm mt-1">Real-time emergency corridor management</p>
        </div>

        {/* ── Login card ───────────────────────────────────────────────── */}
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
              <label htmlFor="username" className="block text-sm text-gray-400 mb-1">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            {/* Password */}
            <div className="mb-6">
              <label htmlFor="password" className="block text-sm text-gray-400 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              disabled={busy || !username || !password}
              className="w-full bg-egc-green-600 hover:bg-egc-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* Demo hint */}
          <div className="mt-6 border-t border-gray-800 pt-4">
            <p className="text-xs text-gray-600 text-center">Demo accounts</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-gray-500">
              <div><span className="font-mono text-gray-400">driver1</span><br />Driver@123</div>
              <div><span className="font-mono text-gray-400">police1</span><br />Police@123</div>
              <div><span className="font-mono text-gray-400">admin_h1</span><br />Admin@123</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
