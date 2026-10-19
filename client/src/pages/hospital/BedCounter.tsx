/**
 * BedCounter — editable available bed count with inline save.
 */

import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface Hospital { availableBeds: number; totalEmergencyBeds: number; name: string; }

interface Props {
  onUpdate: (n: number) => Promise<void>;
}

export function BedCounter({ onUpdate }: Props) {
  const [avail,   setAvail]   = useState<number | null>(null);
  const [total,   setTotal]   = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [input,   setInput]   = useState("");
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    // Fetch hospital info via /auth/me → hospitalId, then /hospital/beds (not a separate endpoint)
    // We call /hospital/incoming which returns emergencies; beds come from the admin's hospital
    // Use GET /hospital/drivers to know the hospital — actually let's just show editable directly
    api.get<{ hospital: Hospital }>("/hospital/me").then(({ data }) => {
      setAvail(data.hospital.availableBeds);
      setTotal(data.hospital.totalEmergencyBeds);
    }).catch(() => { /* hospital info endpoint may not exist yet */ });
  }, []);

  const handleSave = async () => {
    const n = parseInt(input, 10);
    if (isNaN(n) || n < 0) return;
    setSaving(true);
    try {
      await onUpdate(n);
      setAvail(n);
      setEditing(false);
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 font-semibold">AVAILABLE BEDS</p>
          {editing ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min={0}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-20 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white text-lg font-bold focus:outline-none focus:ring-2 focus:ring-egc-green-500"
                autoFocus
              />
              {total !== null && <span className="text-gray-500 text-sm">/ {total} total</span>}
            </div>
          ) : (
            <p className="text-3xl font-bold mt-1">
              <span className={avail === 0 ? "text-egc-red-500" : avail !== null && avail <= 2 ? "text-amber-400" : "text-egc-green-400"}>
                {avail ?? "—"}
              </span>
              {total !== null && <span className="text-gray-600 text-lg font-normal"> / {total}</span>}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-egc-green-600 hover:bg-egc-green-700 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50 transition-colors"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="bg-gray-800 text-gray-400 text-sm px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              id="hospital-edit-beds"
              onClick={() => { setInput(String(avail ?? 0)); setEditing(true); }}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              ✏️ Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
