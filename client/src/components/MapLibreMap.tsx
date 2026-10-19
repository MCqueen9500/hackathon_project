/**
 * MapLibreMap — reusable MapLibre GL map component.
 *
 * Props:
 *  originLat / originLng  : initial ambulance / accident origin (red pin)
 *  livelat / liveLng      : live ambulance position (updates marker in place)
 *  destLat / destLng      : destination (hospital) marker (green cross)
 *  routeGeoJson           : GeoJSON LineString to draw the route
 *  ambulanceMarker        : if true, shows animated ambulance icon on origin
 *  signals                : SignalSnapshot[] to show as coloured dots on map
 *  className              : extra CSS classes
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
}

interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

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
}

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const SIGNAL_COLOR: Record<SignalSnapshot["state"], string> = {
  RED:          "#ef4444",
  GREEN:        "#22c55e",
  YELLOW:       "#eab308",
  FORCED_GREEN: "#4ade80",
};

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const ambMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Track signal markers by id for update
  const sigMarkersRef = useRef<Map<string, HTMLElement>>(new Map());

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

    map.on("load", () => {
      // ── Route ──────────────────────────────────────────────────────────
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

      // ── Origin / live ambulance marker ──────────────────────────────────
      const originEl = document.createElement("div");
      originEl.innerHTML = ambulanceMarker ? "🚑" : "📍";
      originEl.style.cssText = "font-size:26px;line-height:1;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));";
      if (ambulanceMarker) originEl.style.animation = "pulse-ambulance 1.5s ease-in-out infinite";

      const ambMarker = new maplibregl.Marker({ element: originEl, anchor: "bottom" })
        .setLngLat([originLng, originLat])
        .addTo(map);
      ambMarkerRef.current = ambMarker;

      // ── Destination marker ──────────────────────────────────────────────
      if (destLat !== undefined && destLng !== undefined) {
        const destEl = document.createElement("div");
        destEl.innerHTML = "🏥";
        destEl.style.cssText = "font-size:28px;line-height:1;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));";
        new maplibregl.Marker({ element: destEl, anchor: "bottom" })
          .setLngLat([destLng, destLat])
          .addTo(map);
      }

      // ── Signal markers ──────────────────────────────────────────────────
      for (const sig of signals) {
        const el = _buildSignalEl(sig);
        sigMarkersRef.current.set(sig.id, el);
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([sig.lng, sig.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(sig.name ?? `Signal ${sig.id.slice(0, 6)}`))
          .addTo(map);
      }
    });

    return () => { map.remove(); mapRef.current = null; ambMarkerRef.current = null; sigMarkersRef.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live ambulance position update ────────────────────────────────────────
  useEffect(() => {
    if (!ambMarkerRef.current || liveLat == null || liveLng == null) return;
    ambMarkerRef.current.setLngLat([liveLng, liveLat]);
  }, [liveLat, liveLng]);

  // ── Live signal colour updates ────────────────────────────────────────────
  useEffect(() => {
    for (const sig of signals) {
      const el = sigMarkersRef.current.get(sig.id);
      if (el) _updateSignalEl(el, sig.state);
    }
  }, [signals]);

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
      <div
        ref={containerRef}
        className={`rounded-2xl overflow-hidden ${className}`}
        style={{ minHeight: 200 }}
      />
    </>
  );
}

function _buildSignalEl(sig: SignalSnapshot): HTMLElement {
  const el = document.createElement("div");
  el.className = `signal-dot${sig.state === "FORCED_GREEN" ? " forced" : ""}`;
  el.style.backgroundColor = SIGNAL_COLOR[sig.state];
  el.title = sig.name ?? sig.id;
  return el;
}

function _updateSignalEl(el: HTMLElement, state: SignalSnapshot["state"]) {
  el.style.backgroundColor = SIGNAL_COLOR[state];
  if (state === "FORCED_GREEN") el.classList.add("forced");
  else el.classList.remove("forced");
}
