/**
 * Live ambulance cards for police / hospital dashboards.
 * Positions come only from Socket.IO location:update — never device GPS.
 */

import { MapLibreMap } from "./MapLibreMap";
import { useLiveAmbulances } from "../hooks/useLiveAmbulances";
import { useSignals } from "../hooks/useSignals";
import type { Emergency } from "../types/emergency";

interface Props {
  items: Emergency[];
  loading?: boolean;
  emptyTitle?: string;
}

export function LiveAmbulanceList({
  items,
  loading = false,
  emptyTitle = "No live ambulances",
}: Props) {
  const live = useLiveAmbulances();
  const signals = useSignals();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="animate-spin text-4xl">🚑</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
        <p className="text-4xl mb-3">🗺️</p>
        <p className="text-white font-semibold">{emptyTitle}</p>
        <p className="text-gray-500 text-sm mt-1">Markers move when the driver phone sends GPS</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((em) => {
        const ping = live[em.id];
        return (
          <div key={em.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-white font-semibold text-sm">
                  {em.driver?.name ?? "Driver"} · {em.driver?.ambulanceNo ?? "—"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {em.status.replace("_", " ")} · {em.severity}
                </p>
              </div>
            </div>
            <MapLibreMap
              originLat={em.originLat}
              originLng={em.originLng}
              liveLat={ping?.lat ?? null}
              liveLng={ping?.lng ?? null}
              destLat={em.selectedHospital?.lat}
              destLng={em.selectedHospital?.lng}
              routeGeoJson={em.routeGeoJson}
              ambulanceMarker
              signals={signals}
              locationSource={ping?.source ?? null}
              stale={!!ping?.stale}
              staleSeconds={ping?.staleSeconds ?? 0}
              className="h-40 w-full border border-gray-800"
            />
          </div>
        );
      })}
    </div>
  );
}
