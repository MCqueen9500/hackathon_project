/**
 * ProtectedRoute — role-based access guard.
 *
 * Behaviour:
 *   - While auth is loading (session restore in progress) → shows spinner.
 *   - Not logged in → redirects to /login (preserves intended path in `state`).
 *   - Logged in but wrong role → redirects to the user's own dashboard.
 *   - Correct role → renders children.
 */

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import type { Role } from "../types/auth";

// Maps each role to its home path
export const ROLE_HOME: Record<Role, string> = {
  DRIVER:         "/driver",
  POLICE:         "/police",
  HOSPITAL_ADMIN: "/hospital",
};

interface ProtectedRouteProps {
  /** If omitted, any authenticated user can access */
  allowedRole?: Role;
}

export function ProtectedRoute({ allowedRole }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Session restore in progress — show nothing (or a spinner)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="animate-spin text-4xl">🚑</span>
      </div>
    );
  }

  // Not authenticated → go to login, preserve intended path
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Wrong role → redirect to own dashboard
  if (allowedRole && user.role !== allowedRole) {
    return <Navigate to={ROLE_HOME[user.role]} replace />;
  }

  return <Outlet />;
}
