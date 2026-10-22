/**
 * MapLibreMap — reusable MapLibre GL map component.
 *
 * Live ambulance markers animate between pings. The driver's map can show
 * a GPS accuracy circle. Location source / last-known badge overlays the map.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface SignalSnapshot {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  state: "RED" | "GREEN" | "YELLOW" | "FORCED_GREEN";
  simulated?: boolean;
}

interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

export type LocationSourceLabel = "GPS" | "SIMULATOR" | null | undefined;

interface Props {
  originLat: number;
  originLng: number;
  liveLat?: number | null;
  liveLng?: number | null;
  destLat?: number;
  destLng?: number;
  routeGeoJson?: GeoJsonLineString | null | unknown;
  ambulanceMarker?: boolean;
  signals?: SignalSnapshot[];
  className?: string;
  /** Horizontal accuracy in metres — drawn as a circle on the driver map. */
  accuracyM?: number | null;
  showAccuracyCircle?: boolean;
  locationSource?: LocationSourceLabel;
  stale?: boolean;
  staleSeconds?: number;
}

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ANIM_MS = 1_200;

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

function circleFeature(lat: number, lng: number, radiusM: number, points = 64) {
  const coords: [number, number][] = [];
  const latR = radiusM / 111_320;
  const lngR = radiusM / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    coords.push([lng + lngR * Math.cos(a), lat + latR * Math.sin(a)]);
  }
  return {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [coords] },
    properties: {},
  };
}

export function MapLibreMap({
  originLat,
  originLng,
  liveLat,
  liveLng,
  destLat,
  destLng,
  routeGeoJson,
  ambulanceMarker = false,
  signals = [],
  className = "",
  accuracyM = null,
  showAccuracyCircle = false,
  locationSource = null,
  stale = false,
  staleSeconds = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const ambMarkerRef = useRef<maplibregl.Marker | null>(null);
  const posRef       = useRef<[number, number]>([originLng, originLat]);
  const rafRef       = useRef<number | null>(null);
  const accuracyRef  = useRef<number | null>(accuracyM ?? null);
  const liveRef      = useRef({ lat: liveLat, lng: liveLng, acc: accuracyM });
  const signalsRef   = useRef(signals);
  liveRef.current = { lat: liveLat, lng: liveLng, acc: accuracyM };
  signalsRef.current = signals;

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([originLng, originLat]);
    if (destLat !== undefined && destLng !== undefined) bounds.extend([destLng, destLat]);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     OSM_STYLE,
      bounds,
      fitBoundsOptions: { padding: 60, maxZoom: 15 },
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    posRef.current = [originLng, originLat];

    map.on("load", () => {
      const geo = routeGeoJson as GeoJsonLineString | null | undefined;
      const hasRoute = geo?.type === "LineString" && (geo.coordinates?.length ?? 0) >= 2;

      const routeData = hasRoute
        ? { type: "Feature" as const, geometry: geo!, properties: {} }
        : {
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: destLat !== undefined && destLng !== undefined
                ? ([[originLng, originLat], [destLng, destLat]] as [number, number][])
                : ([[originLng, originLat]] as [number, number][]),
            },
            properties: {},
          };

      map.addSource("route", { type: "geojson", data: routeData });
      map.addLayer({ id: "route-casing", type: "line", source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#064e3b", "line-width": 8, "line-opacity": 0.7 } });
      map.addLayer({ id: "route-fill", type: "line", source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#22c55e", "line-width": 5, "line-opacity": 0.95 } });
      map.addLayer({ id: "route-dash", type: "line", source: "route",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": "#bbf7d0", "line-width": 2, "line-opacity": 0.7,
          "line-dasharray": [0, 4, 3] } });

      const empty = circleFeature(originLat, originLng, 1);
      map.addSource("accuracy", { type: "geojson", data: empty });
      map.addLayer({
        id: "accuracy-fill",
        type: "fill",
        source: "accuracy",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "accuracy-line",
        type: "line",
        source: "accuracy",
        paint: { "line-color": "#38bdf8", "line-width": 1.5, "line-opacity": 0.7 },
      });

      map.addSource("signals", { type: "geojson", data: signalsToFC(signalsRef.current) });
      map.addLayer({
        id: "signals-glow",
        type: "circle",
        source: "signals",
        filter: ["==", ["get", "state"], "FORCED_GREEN"],
        paint: {
          "circle-radius": 18,
          "circle-color": "#4ade80",
          "circle-opacity": 0.30,
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
            9,
          ],
          "circle-color": [
            "match", ["get", "state"],
            "RED", "#ef4444",
            "GREEN", "#22c55e",
            "YELLOW", "#eab308",
            "FORCED_GREEN", "#4ade80",
            "#9ca3af",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": [
            "match", ["get", "state"],
            "FORCED_GREEN", "#bbf7d0",
            "#ffffff",
          ],
        },
      });

      // Signal popup on click
      const signalPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        className: "egc-signal-popup",
        maxWidth: "200px",
      });
      map.on("click", "signals-dots", (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const { name, state } = feat.properties as { name: string | null; state: string };
        const coords = (feat.geometry as unknown as { coordinates: [number, number] }).coordinates;
        const stateLabel: Record<string, string> = {
          RED: "🔴 RED",
          GREEN: "🟢 GREEN",
          YELLOW: "🟡 YELLOW",
          FORCED_GREEN: "💚 CORRIDOR GREEN",
        };
        signalPopup
          .setLngLat(coords)
          .setHTML(`<div style="font-size:12px;font-family:Inter,sans-serif;">
            <b style="color:#f1f5f9">${name ?? "Signal"}</b><br/>
            <span style="color:#94a3b8">${stateLabel[state] ?? state}</span>
          </div>`)
          .addTo(map);
        e.preventDefault();
      });
      map.on("mouseenter", "signals-dots", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "signals-dots", () => { map.getCanvas().style.cursor = ""; });

      const originEl = document.createElement("div");
      originEl.innerHTML = ambulanceMarker ? "🚑" : "📍";
      originEl.style.cssText = "font-size:26px;line-height:1;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));";
      if (ambulanceMarker) originEl.style.animation = "pulse-ambulance 1.5s ease-in-out infinite";

      const startLng = liveRef.current.lng ?? originLng;
      const startLat = liveRef.current.lat ?? originLat;
      const ambMarker = new maplibregl.Marker({ element: originEl, anchor: "bottom" })
        .setLngLat([startLng, startLat])
        .addTo(map);
      ambMarkerRef.current = ambMarker;
      posRef.current = [startLng, startLat];

      if (destLat !== undefined && destLng !== undefined) {
        const destEl = document.createElement("div");
        destEl.innerHTML = "🏥";
        destEl.style.cssText = "font-size:28px;line-height:1;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));";
        new maplibregl.Marker({ element: destEl, anchor: "bottom" })
          .setLngLat([destLng, destLat])
          .addTo(map);
      }

    });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
      ambMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Update the GPS accuracy circle. Args: lng, lat (MapLibre convention) → fixed to call circleFeature(lat, lng). */
  const setAccuracyCircle = (lng: number, lat: number, radiusM: number | null) => {
    const map = mapRef.current;
    if (!map?.getSource("accuracy")) return;
    const src = map.getSource("accuracy") as maplibregl.GeoJSONSource;
    if (!showAccuracyCircle || radiusM == null || radiusM <= 0) {
      src.setData(circleFeature(lat, lng, 1)); // lat first, lng second — correct order
      map.setLayoutProperty("accuracy-fill", "visibility", "none");
      map.setLayoutProperty("accuracy-line", "visibility", "none");
      return;
    }
    map.setLayoutProperty("accuracy-fill", "visibility", "visible");
    map.setLayoutProperty("accuracy-line", "visibility", "visible");
    // circleFeature(lat, lng, radius) — lat first, lng second
    src.setData(circleFeature(lat, lng, radiusM));
  };

  // ── Smooth ambulance animation between pings ──────────────────────────────
  useEffect(() => {
    if (liveLat == null || liveLng == null) return;
    accuracyRef.current = accuracyM ?? null;

    const to: [number, number] = [liveLng, liveLat];
    const from = posRef.current;
    const marker = ambMarkerRef.current;
    const map = mapRef.current;
    if (!marker) {
      posRef.current = to;
      return;
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (dist < 1e-8) {
      marker.setLngLat(to);
      posRef.current = to;
      setAccuracyCircle(to[0], to[1], accuracyRef.current);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_MS);
      const eased = t * (2 - t);
      const lng = from[0] + (to[0] - from[0]) * eased;
      const lat = from[1] + (to[1] - from[1]) * eased;
      marker.setLngLat([lng, lat]);
      posRef.current = [lng, lat];
      setAccuracyCircle(lng, lat, accuracyRef.current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);

    if (map) {
      const b = map.getBounds();
      if (b && !b.contains(to)) {
        map.panTo(to, { duration: ANIM_MS });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLat, liveLng, accuracyM, showAccuracyCircle]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("signals") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(signalsToFC(signals));
  }, [signals]);

  const sourceLabel =
    locationSource === "SIMULATOR" ? "Simulator"
    : locationSource === "GPS" ? "Phone GPS"
    : null;

  return (
    <>
      <style>{`
        @keyframes pulse-ambulance {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.18); }
        }
        .signal-dot {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2.5px solid rgba(255,255,255,0.85);
          box-shadow: 0 0 6px 2px rgba(0,0,0,0.45);
          transition: background-color 0.4s ease;
          cursor: pointer;
        }
        .signal-dot.forced { box-shadow: 0 0 10px 4px rgba(74,222,128,0.7); animation: glow-green 1s ease-in-out infinite; }
        @keyframes glow-green {
          0%, 100% { box-shadow: 0 0 8px 3px rgba(74,222,128,0.5); }
          50%       { box-shadow: 0 0 14px 6px rgba(74,222,128,0.9); }
        }
      `}</style>
      <div className="relative">
        {(sourceLabel || stale) && (
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 pointer-events-none">
            {sourceLabel && (
              <span className="text-[11px] font-semibold bg-gray-950/85 text-white border border-gray-700 rounded-full px-2.5 py-1 shadow">
                Location source: {sourceLabel}
              </span>
            )}
            {stale && (
              <span className="text-[11px] font-semibold bg-amber-950/90 text-amber-200 border border-amber-700 rounded-full px-2.5 py-1 shadow">
                Last known {staleSeconds}s ago
              </span>
            )}
          </div>
        )}
        {signals.length > 0 && (
          <div className="absolute bottom-2 left-2 z-10 flex gap-2 pointer-events-none text-[10px] font-semibold bg-gray-950/80 text-white rounded-full px-2 py-1 border border-gray-700">
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-red-500" />Red</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-yellow-400" />Yellow</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-green-500" />Green</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-lime-400" />Corridor</span>
          </div>
        )}
        <div
          ref={containerRef}
          className={`rounded-2xl overflow-hidden ${className}`}
          style={{ minHeight: 200 }}
        />
      </div>
    </>
  );
}
