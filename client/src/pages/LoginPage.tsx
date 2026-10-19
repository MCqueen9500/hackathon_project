import { useState } from "react";

/**
 * /login — Phase 0 stub.
 * Full implementation (JWT, role-based redirect) in Phase 1.
 */
export default function LoginPage() {
  const [role, setRole] = useState<"DRIVER" | "POLICE" | "HOSPITAL_ADMIN">(
    "DRIVER"
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-egc-green-600 mb-4">
            <span className="text-3xl" role="img" aria-label="ambulance">
              🚑
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            Emergency Green Corridor
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Real-time emergency corridor management
          </p>
        </div>

        {/* Login card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in</h2>

          {/* Role selector (demo convenience) */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Role</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["DRIVER", "Driver"],
                  ["POLICE", "Police"],
                  ["HOSPITAL_ADMIN", "Hospital"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  id={`role-${value.toLowerCase()}`}
                  onClick={() => setRole(value)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    role === value
                      ? "bg-egc-green-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label
              htmlFor="username"
              className="block text-sm text-gray-400 mb-1"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              placeholder="Enter your username"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 focus:border-transparent"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="block text-sm text-gray-400 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 focus:border-transparent"
            />
          </div>

          <button
            id="login-submit"
            type="button"
            className="w-full bg-egc-green-600 hover:bg-egc-green-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            Sign in
          </button>

          <p className="text-center text-xs text-gray-600 mt-4">
            Auth integration coming in Phase 1
          </p>
        </div>
      </div>
    </div>
  );
}
