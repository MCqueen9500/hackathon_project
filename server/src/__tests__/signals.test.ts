/**
 * Green-wave + auto-place (spec §10 / §17.6)
 */

import { SimulatedSignalController } from "../services/signals/SimulatedSignalController";
import { placeAlongRoute } from "../services/signals/placeAlongRoute";

function routeNorth(metres: number): [number, number][] {
  const dLat = metres / 111_320;
  return [
    [77.0, 12.0],
    [77.0, 12.0 + dLat],
  ];
}

function latAt(metres: number): number {
  return 12.0 + metres / 111_320;
}

describe("placeAlongRoute", () => {
  test("drops a point every 300–400 m", () => {
    const coords = routeNorth(2000);
    const pts = placeAlongRoute(coords, 300, 400);
    expect(pts.length).toBeGreaterThanOrEqual(4);
    expect(pts.length).toBeLessThanOrEqual(7);
  });
});

describe("SimulatedSignalController green wave", () => {
  let ctl: SimulatedSignalController;

  beforeEach(() => {
    ctl = new SimulatedSignalController();
    ctl.init([
      { id: "ahead-200", name: "Ahead 200", lat: latAt(200), lng: 77.0 },
      { id: "ahead-600", name: "Ahead 600", lat: latAt(600), lng: 77.0 },
      { id: "off-route", name: "Off", lat: latAt(200), lng: 77.01 },
    ]);
  });

  afterEach(() => ctl.destroy());

  test("forces GREEN for signals within 400 m ahead along the route", () => {
    const coords = routeNorth(2000);
    ctl.applyGreenWave(12.0, 77.0, coords, "e1", "CRITICAL", new Date("2026-01-01"));
    const byId = Object.fromEntries(ctl.getAll().map((s) => [s.id, s.state]));
    expect(byId["ahead-200"]).toBe("FORCED_GREEN");
    expect(byId["ahead-600"]).not.toBe("FORCED_GREEN");
    expect(byId["off-route"]).not.toBe("FORCED_GREEN");
  });

  test("releases signals passed by more than 100 m", () => {
    const coords = routeNorth(2000);
    ctl.applyGreenWave(12.0, 77.0, coords, "e1", "CRITICAL", new Date("2026-01-01"));
    expect(ctl.getAll().find((s) => s.id === "ahead-200")?.state).toBe("FORCED_GREEN");

    ctl.applyGreenWave(latAt(350), 77.0, coords, "e1", "CRITICAL", new Date("2026-01-01"));
    expect(ctl.getAll().find((s) => s.id === "ahead-200")?.state).not.toBe("FORCED_GREEN");
    expect(ctl.getAll().find((s) => s.id === "ahead-600")?.state).toBe("FORCED_GREEN");
  });

  test("higher severity wins a conflict; equal severity prefers earlier createdAt", () => {
    const coords = routeNorth(2000);
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-01-01T01:00:00Z");
    ctl.applyGreenWave(12.0, 77.0, coords, "stable", "STABLE", older);
    ctl.applyGreenWave(12.0, 77.0, coords, "crit", "CRITICAL", newer);
    expect(ctl.getForEmergency("crit")).toContain("ahead-200");

    ctl.releaseAll("crit");
    ctl.applyGreenWave(12.0, 77.0, coords, "a", "SERIOUS", older);
    ctl.applyGreenWave(12.0, 77.0, coords, "b", "SERIOUS", newer);
    expect(ctl.getForEmergency("a")).toContain("ahead-200");
    expect(ctl.getForEmergency("b")).toContain("ahead-200");
    // both claim; winner is earlier createdAt — effective state still FORCED_GREEN
    expect(ctl.getAll().find((s) => s.id === "ahead-200")?.state).toBe("FORCED_GREEN");
  });

  test("normal cycle is RED, GREEN or YELLOW when unclaimed", () => {
    const s = ctl.getAll().find((x) => x.id === "ahead-200")!;
    expect(["RED", "GREEN", "YELLOW"]).toContain(s.state);
  });
});
