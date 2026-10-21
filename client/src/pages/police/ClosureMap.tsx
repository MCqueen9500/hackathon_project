/**
 * ClosureMap — police road closure tool.
 *
 * Click the map to place a square closure polygon (500m side).
 * Lists all active closures with a "Clear" button for each.
 * On mount, loads existing closures and listens for socket closure:updated.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getClosures, createClosure, deleteClosure, type ClosureRecord as Closure } from "../../api/policeApi";

interface Props {
  onClosureChange?: () => void;
}

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Build a square GeoJSON polygon centred on [lat,lng], side = sideMetres */
function squarePolygon(lat: number, lng: number, sideMetres = 500) {
  const latDeg = (sideMetres / 2) / 111_320;
  const lngDeg = (sideMetres / 2) / (111_320 * Math.cos((lat * Math.PI) / 180));
  const coords: [number, number][] = [
    [lng - lngDeg, lat - latDeg],
    [lng + lngDeg, lat - latDeg],
    [lng + lngDeg, lat + latDeg],
    [lng - lngDeg, lat + latDeg],
    [lng - lngDeg, lat - latDeg], // close ring
  ];
  return {
    type: "Polygon" as const,
    coordinates: [coords],
  };
}

export function ClosureMap({ onClosureChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [status,   setStatus]   = useState<string | null>(null);

  // ── Fetch closures ─────────────────────────────────────────────────────────
  const fetchClosures = useCallback(async () => {
    try {
      const closures = await getClosures();
      setClosures(closures);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchClosures(); }, [fetchClosures]);

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container:  containerRef.current,
      style:      OSM_STYLE,
      center:     [77.5946, 12.9716], // Bangalore (matches DEMO_CENTER_*)
      zoom:       13,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    // Click to place closure square
    map.on("click", async (e) => {
      if (busy) return;
      const { lat, lng } = e.lngLat;
      setBusy(true);
      setStatus("Placing closure…");
      try {
        const polygon = squarePolygon(lat, lng);
        await createClosure(JSON.stringify(polygon));
        setStatus("✅ Closure placed — affected routes are being re-calculated.");
        await fetchClosures();
        onClosureChange?.();
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to place closure";
        setStatus(`❌ ${msg}`);
      } finally {
        setBusy(false);
        setTimeout(() => setStatus(null), 5000);
      }
    });

    map.on("load", () => {
      // Closure polygons source + layer
      map.addSource("closures", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "closures-fill",
        type: "fill",
        source: "closures",
        paint: { "fill-color": "#ef4444", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "closures-outline",
        type: "line",
        source: "closures",
        paint: { "line-color": "#ef4444", "line-width": 2, "line-dasharray": [3, 2] },
      });
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update closure polygons on map whenever list changes ──────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const features = closures.map((c) => {
      let geo: unknown = null;
      try { geo = JSON.parse(c.polygonGeoJson); } catch { return null; }
      return { type: "Feature" as const, geometry: geo, properties: { id: c.id } };
    }).filter(Boolean);

    (map.getSource("closures") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: features as GeoJSON.Feature[],
    });
  }, [closures]);

  // ── Clear closure ──────────────────────────────────────────────────────────
  const handleClear = async (id: string) => {
    setBusy(true);
    try {
      await deleteClosure(id);
      setStatus("✅ Closure cleared — routes are being updated.");
      await fetchClosures();
      onClosureChange?.();
    } catch {
      setStatus("❌ Failed to clear closure.");
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-white font-semibold">Road Closures</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Click anywhere on the map to place a 500 m closure. Active emergencies crossing it will be re-routed automatically.
        </p>
      </div>

      {/* Status toast */}
      {status && (
        <div className={`text-sm rounded-xl px-4 py-3 border ${
          status.startsWith("❌")
            ? "bg-red-950/60 border-egc-red-800 text-red-300"
            : "bg-egc-green-900/40 border-egc-green-800 text-egc-green-300"
        }`}>
          {status}
        </div>
      )}

      {/* Map */}
      <div
        ref={containerRef}
        className="rounded-2xl overflow-hidden border border-gray-800"
        style={{ height: 280, cursor: busy ? "wait" : "crosshair" }}
      />

      {/* Active closures list */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">
          Active Closures ({closures.length})
        </p>
        {closures.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <p className="text-gray-500 text-sm">No active closures</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {closures.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 bg-gray-900 border border-egc-red-900 rounded-xl px-4 py-3"
              >
                <span className="text-egc-red-400 text-lg flex-shrink-0">🚧</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-semibold">Closure</p>
                  <p className="text-xs text-gray-500">
                    {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    &nbsp;· ID: {c.id.slice(0, 8)}
                  </p>
                </div>
                <button
                  id={`clear-closure-${c.id}`}
                  onClick={() => handleClear(c.id)}
                  disabled={busy}
                  className="text-xs font-semibold bg-red-950/60 hover:bg-red-900/60 border border-egc-red-800 text-egc-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
