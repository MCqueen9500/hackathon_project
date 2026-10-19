/**
 * services/instances.ts
 *
 * Singleton service instances shared across routes, scheduler and tests.
 * Phase 3/10: EmergencyService is now wired to OrsRankingProvider
 * (OpenRouteService with automatic OSRM fallback).
 */

import { EmergencyService } from "./EmergencyService";
import { OrsRankingProvider } from "./ranking/OrsRankingProvider";

export const emergencyService = new EmergencyService(new OrsRankingProvider());
