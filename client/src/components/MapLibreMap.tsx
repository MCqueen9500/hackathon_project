/**
 * MapLibreMap — reusable MapLibre GL map component.
 *
 * Props:
 *  - originLat / originLng  : ambulance / accident origin marker (red pin)
 *  - destLat / destLng      : destination (hospital) marker (green cross), optional
 *  - routeGeoJson           : GeoJSON LineString to draw the route, optional
 *  - ambulanceMarker        : if true, shows animated ambulance icon on origin
 *  - className              : extra CSS classes for the container
 *
 * Map tiles: OpenStreetMap via a free MapLibre-compatible style.
 * No API key required for tile rendering.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

interface Props {
  originLat: number;
  originLng: number;
  destLat?: number;
  destLng?: number;
  routeGeoJson?: GeoJsonLineString | null | unknown;
  ambulanceMarker?: boolean;
  className?: string;
}

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function MapLibreMap({
  originLat,
  originLng,
  destLat,
  destLng,
  routeGeoJson,
  ambulanceMarker = false,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);

  // ── initialise map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([originLng, originLat]);
    if (destLat !== undefined && destLng !== undefined) {
      bounds.extend([destLng, destLat]);
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      bounds,
      fitBoundsOptions: { padding: 50, maxZoom: 15 },
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    mapRef.current = map;

    map.on("load", () => {
      // ── Route line ─────────────────────────────────────────────────────
      const geo = routeGeoJson as GeoJsonLineString | null | undefined;
      if (geo && geo.type === "LineString" && geo.coordinates?.length >= 2) {
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", geometry: geo, properties: {} },
        });
        // Casing (dark border)
        map.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#064e3b", "line-width": 8, "line-opacity": 0.8 },
        });
        // Fill (green)
        map.addLayer({
          id: "route-fill",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#22c55e", "line-width": 5, "line-opacity": 0.95 },
        });
        // Animated dash overlay
        map.addLayer({
          id: "route-dash",
          type: "line",
          source: "route",
          layout: { "line-cap": "butt", "line-join": "round" },
          paint: {
            "line-color": "#bbf7d0",
            "line-width": 2,
            "line-opacity": 0.7,
            "line-dasharray": [0, 4, 3],
          },
        });
      } else {
        // Straight-line dashed fallback
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: destLat !== undefined && destLng !== undefined
                ? [[originLng, originLat], [destLng, destLat]]
                : [[originLng, originLat], [originLng, originLat]],
            },
            properties: {},
          },
        });
        map.addLayer({
          id: "route-dash",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#6b7280",
            "line-width": 2,
            "line-dasharray": [3, 3],
            "line-opacity": 0.6,
          },
        });
      }

      // ── Origin marker (ambulance or accident pin) ─────────────────────
      const originEl = document.createElement("div");
      originEl.className = "map-marker-origin";
      originEl.innerHTML = ambulanceMarker ? "🚑" : "📍";
      originEl.style.cssText =
        "font-size:24px;line-height:1;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));";
      if (ambulanceMarker) {
        originEl.style.animation = "pulse-ambulance 1.5s ease-in-out infinite";
      }

      new maplibregl.Marker({ element: originEl, anchor: "bottom" })
        .setLngLat([originLng, originLat])
        .addTo(map);

      // ── Destination marker (hospital) ─────────────────────────────────
      if (destLat !== undefined && destLng !== undefined) {
        const destEl = document.createElement("div");
        destEl.innerHTML = "🏥";
        destEl.style.cssText =
          "font-size:28px;line-height:1;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));";
        new maplibregl.Marker({ element: destEl, anchor: "bottom" })
          .setLngLat([destLng, destLat])
          .addTo(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Only run once on mount — lat/lng changes handled by second effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update ambulance marker position live ────────────────────────────────
  useEffect(() => {
    // If we need live-tracking in future we'd update the marker here.
    // For now, re-initialisation handles it via key-prop changes from parent.
  }, [originLat, originLng]);

  return (
    <>
      <style>{`
        @keyframes pulse-ambulance {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.15); }
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
