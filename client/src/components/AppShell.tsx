/**
 * AppShell — top nav bar + main content area.
 *
 * Used by all three role dashboards. Shows:
 *   - EGC logo + role badge
 *   - Socket connection indicator (green dot / grey dot)
 *   - User name + logout button
 */

import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useSocket } from "../hooks/useSocket";
import type { Role } from "../types/auth";

const ROLE_LABEL: Record<Role, string> = {
  DRIVER:         "Driver",
  POLICE:         "Police",
  HOSPITAL_ADMIN: "Hospital Admin",
  ADMIN:          "Admin",
};

const ROLE_COLOR: Record<Role, string> = {
  DRIVER:         "bg-egc-green-600",
  POLICE:         "bg-blue-600",
  HOSPITAL_ADMIN: "bg-purple-600",
  ADMIN:          "bg-amber-600",
};

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const { connected }    = useSocket();

  const role = user?.role as Role;

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      {/* ── Nav bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-gray-900 border-b border-gray-800 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Logo */}
          <span className="text-xl select-none" aria-hidden>🚑</span>
          <span className="font-bold text-white text-sm hidden sm:block tracking-tight">
            Emergency Green Corridor
          </span>
          <span className="font-bold text-white text-sm sm:hidden tracking-tight">EGC</span>

          {/* Role badge */}
          {role && (
            <span
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold text-white ${ROLE_COLOR[role]}`}
            >
              {ROLE_LABEL[role]}
            </span>
          )}

          {/* Admin Signals link */}
          {role === "ADMIN" && (
            <Link
              to="/admin/signals"
              id="nav-signals"
              className="text-sm text-amber-400 hover:text-amber-300 transition-colors px-2 py-1 rounded-lg hover:bg-gray-800 font-semibold flex-shrink-0"
            >
              🚦 Signals
            </Link>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Socket indicator */}
          <span
            title={connected ? "Real-time: connected" : "Real-time: disconnected"}
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${
              connected ? "bg-egc-green-500" : "bg-gray-600"
            }`}
            aria-label={connected ? "Connected" : "Disconnected"}
          />

          {/* User name */}
          {user && (
            <span className="text-sm text-gray-300 hidden sm:block truncate max-w-[120px]">
              {user.name}
            </span>
          )}

          {/* Logout */}
          <button
            id="nav-logout"
            onClick={() => logout()}
            className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
