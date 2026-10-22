/**
 * ADMIN Signals editor — click to add, drag to move, delete, auto-place along a route.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";
import { useSignals } from "../../hooks/useSignals";
import type { SignalSnapshot } from "../../components/MapLibreMap";

interface RouteOption {
  id: string;
  status: string;
  severity: string;
  driver: { name: string; ambulanceNo: string | null } | null;
  selectedHospital: { name: string } | null;
}

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";

function signalsToFC(signals: SignalSnapshot[]) {
  return {
    type: "FeatureCollection" as const,
    features: signals.map((s) => ({
      type: "Feature" as const,
      id: s.id,
      geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] as [number, number] },
      properties: { id: s.id, name: s.name, state: s.state, simulated: !!s.simulated },
    })),
  };
}

export default function SignalsPage() {
  const live = useSignals();
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [routeId, setRouteId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dragRef = useRef<maplibregl.Marker | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    api.get<{ routes: RouteOption[] }>("/signals/routes")
      .then((r) => {
        setRoutes(r.data.routes ?? []);
        setRouteId((cur) => cur || r.data.routes?.[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  const syncSource = useCallback((rows: SignalSnapshot[]) => {
    const src = mapRef.current?.getSource("signals") as maplibregl.GeoJSONSource | undefined;
    src?.setData(signalsToFC(rows));
  }, []);

  useEffect(() => { syncSource(live); }, [live, syncSource]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const first = liveRef.current[0];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: first ? [first.lng, first.lat] : [77.5946, 12.9716],
      zoom: 13,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("signals", { type: "geojson", data: signalsToFC(liveRef.current) });

      // Glow layer for corridor green signals
      map.addLayer({
        id: "signals-glow",
        type: "circle",
        source: "signals",
        filter: ["==", ["get", "state"], "FORCED_GREEN"],
        paint: {
          "circle-radius": 20,
          "circle-color": "#4ade80",
          "circle-opacity": 0.28,
        },
      });

      map.addLayer({
        id: "signals-dots",
        type: "circle",
        source: "signals",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "state"], "FORCED_GREEN"], 12,
            10,
          ],
          "circle-color": [
            "match", ["get", "state"],
            "RED", "#ef4444",
            "GREEN", "#22c55e",
            "YELLOW", "#eab308",
            "FORCED_GREEN", "#4ade80",
            "#38bdf8",
          ],
          "circle-stroke-width": [
            "case", ["get", "simulated"], 3, 2,
          ],
          "circle-stroke-color": [
            "case", ["get", "simulated"], "#facc15", "#ffffff",
          ],
        },
      });
    });


    map.on("click", "signals-dots", (e) => {
      e.preventDefault();
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const row = liveRef.current.find((s) => s.id === id);
      if (row) selectSignal(row, map);
      e.originalEvent.stopPropagation();
    });

    map.on("click", "signals-glow", (e) => {
      e.preventDefault();
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const row = liveRef.current.find((s) => s.id === id);
      if (row) selectSignal(row, map);
      e.originalEvent.stopPropagation();
    });

    map.on("click", (e) => {
      // Only add a signal when clicking on empty map
      const feats = map.queryRenderedFeatures(e.point, { layers: ["signals-dots", "signals-glow"] });
      if (feats.length > 0) return;
      void addAt(e.lngLat.lat, e.lngLat.lng);
    });

    map.on("mouseenter", "signals-dots", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "signals-dots", () => { map.getCanvas().style.cursor = ""; });

    return () => {
      dragRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSignal = (row: SignalSnapshot, map: maplibregl.Map) => {
    setSelectedId(row.id);
    dragRef.current?.remove();
    const el = document.createElement("div");
    el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#facc15;border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.5);cursor:grab;";
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([row.lng, row.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      void api.patch(`/signals/${row.id}`, { lat, lng }).catch(() => setStatus("Move failed"));
    });
    dragRef.current = marker;
  };

  const addAt = async (lat: number, lng: number) => {
    setBusy(true);
    setStatus(null);
    try {
      const { data } = await api.post<{ signal: SignalSnapshot }>("/signals", {
        lat, lng, name: "Signal", simulated: true,
      });
      setStatus(`Added simulated signal at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      const map = mapRef.current;
      if (map && data.signal) {
        selectSignal({ ...data.signal, state: "RED" }, map);
      }
    } catch {
      setStatus("Could not add signal");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.delete(`/signals/${selectedId}`);
      dragRef.current?.remove();
      dragRef.current = null;
      setSelectedId(null);
      setStatus("Signal deleted");
    } catch {
      setStatus("Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const handleAutoPlace = async () => {
    if (!routeId) { setStatus("Select a route first (create an emergency with a path)."); return; }
    setBusy(true);
    try {
      const { data } = await api.post<{ count: number }>("/signals/auto-place", { emergencyId: routeId });
      setStatus(`Placed ${data.count} simulated signals along the route (every 300–400 m).`);
    } catch {
      setStatus("Auto-place failed — does the emergency have a route?");
    } finally {
      setBusy(false);
    }
  };

  const selected = live.find((s) => s.id === selectedId);
  const forced = live.filter((s) => s.state === "FORCED_GREEN").length;
  const simulated = live.filter((s) => s.simulated).length;
  const osm = live.length - simulated;

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">🚦 Traffic Signals</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {live.length} total · {osm} OSM · {simulated} simulated · {forced} corridor green
          </p>
          <p className="text-xs text-gray-600 mt-1">Click empty map to add · Click existing marker to select · Drag yellow pin to move</p>
        </div>


        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="">Select a route…</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.driver?.name ?? "Driver"} → {r.selectedHospital?.name ?? "hospital"} ({r.status})
              </option>
            ))}
          </select>
          <button
            id="signals-autoplace-btn"
            onClick={() => void handleAutoPlace()}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl text-sm"
          >
            Auto-place demo signals along route
          </button>
          <button
            id="signals-delete-btn"
            onClick={() => void handleDelete()}
            disabled={busy || !selectedId}
            className="bg-red-950 hover:bg-red-900 border border-red-800 disabled:opacity-50 text-red-300 font-semibold px-4 py-2 rounded-xl text-sm"
          >
            Delete selected
          </button>
        </div>

        {status && (
          <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800 rounded-xl px-3 py-2">{status}</p>
        )}

        {selected && (
          <p className="text-xs text-gray-400">
            Selected: {selected.name ?? selected.id.slice(0, 8)} · {selected.simulated ? "simulated" : "OSM"} · {selected.state}
          </p>
        )}

        <div
          ref={containerRef}
          className="w-full h-[520px] rounded-2xl overflow-hidden border border-gray-800"
        />
      </div>
    </AppShell>
  );
}
