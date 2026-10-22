/**
 * services/instances.ts
 *
 * Singleton service instances shared across routes, scheduler and tests.
 * Phase 3/10: EmergencyService is now wired to OrsRankingProvider
 * (OpenRouteService with automatic OSRM fallback).
 */

import { EmergencyService } from "./EmergencyService";
import { OrsRankingProvider } from "./ranking/OrsRankingProvider";
import { DemoAutoScheduler } from "./scheduler/DemoAutoScheduler";

export const emergencyService = new EmergencyService(new OrsRankingProvider());
export const demoAutoScheduler = new DemoAutoScheduler(emergencyService);

// Hydrate on startup: re-schedule any pending DEMO_AUTO emergencies
void demoAutoScheduler.hydrate();
