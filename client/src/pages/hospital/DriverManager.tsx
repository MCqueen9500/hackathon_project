/**
 * DriverManager — register new drivers and toggle active/inactive.
 */

import { useState } from "react";
import type { DriverUser } from "../../types/emergency";

interface Props {
  drivers: DriverUser[];
  onRegister: (opts: { name: string; username: string; password: string; ambulanceNo: string }) => Promise<void>;
  onToggle: (id: string, active: boolean) => Promise<void>;
}

export function DriverManager({ drivers, onRegister, onToggle }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name,     setName]     = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ambulanceNo, setAmbulanceNo] = useState("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!name || !username || !password || !ambulanceNo) {
      setError("All fields are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRegister({ name, username, password, ambulanceNo });
      setName(""); setUsername(""); setPassword(""); setAmbulanceNo("");
      setShowForm(false);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to register driver."
      );
    } finally { setBusy(false); }
  };

  const handleToggle = async (id: string, currentlyActive: boolean) => {
    setToggling(id);
    try { await onToggle(id, !currentlyActive); }
    finally { setToggling(null); }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header + add button */}
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Drivers ({drivers.length})</h2>
        <button
          id="hospital-add-driver-btn"
          onClick={() => setShowForm((v) => !v)}
          className="bg-egc-green-600 hover:bg-egc-green-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          {showForm ? "✕ Cancel" : "+ Add Driver"}
        </button>
      </div>

      {/* Register form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 flex flex-col gap-3">
          <h3 className="text-white font-semibold text-sm">Register New Driver</h3>

          {error && (
            <div role="alert" className="bg-red-950 border border-egc-red-800 text-red-300 text-xs rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {[
            { label: "Full Name",      value: name,        set: setName,        type: "text",     id: "drv-name"   },
            { label: "Username",       value: username,    set: setUsername,    type: "text",     id: "drv-user"   },
            { label: "Temp Password",  value: password,    set: setPassword,    type: "password", id: "drv-pass"   },
            { label: "Ambulance No.",  value: ambulanceNo, set: setAmbulanceNo, type: "text",     id: "drv-amb"    },
          ].map(({ label, value, set, type, id }) => (
            <div key={id}>
              <label htmlFor={id} className="block text-xs text-gray-400 mb-1">{label}</label>
              <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => set(e.target.value)}
                disabled={busy}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 disabled:opacity-50"
              />
            </div>
          ))}

          <button
            onClick={handleRegister}
            disabled={busy}
            className="w-full bg-egc-green-600 hover:bg-egc-green-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {busy
              ? <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Registering…</>
              : "Register Driver"}
          </button>
        </div>
      )}

      {/* Driver list */}
      {drivers.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <p className="text-3xl mb-3">👤</p>
          <p className="text-white font-semibold">No drivers registered</p>
          <p className="text-gray-500 text-sm mt-1">Use the button above to add a driver</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {drivers.map((d) => (
            <div
              key={d.id}
              className={`flex items-center gap-3 bg-gray-900 border rounded-xl px-4 py-3 ${
                d.active ? "border-gray-800" : "border-gray-700 opacity-60"
              }`}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${d.active ? "bg-egc-green-500" : "bg-gray-600"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{d.name}</p>
                <p className="text-xs text-gray-500">
                  <span className="font-mono">{d.username}</span>
                  {d.ambulanceNo ? ` · ${d.ambulanceNo}` : ""}
                </p>
              </div>
              <button
                onClick={() => handleToggle(d.id, d.active)}
                disabled={toggling === d.id}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                  d.active
                    ? "bg-gray-800 hover:bg-red-950 text-gray-400 hover:text-egc-red-400 border border-gray-700"
                    : "bg-egc-green-900/40 hover:bg-egc-green-800/40 text-egc-green-400 border border-egc-green-800"
                }`}
              >
                {toggling === d.id ? "…" : d.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
