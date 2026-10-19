/**
 * services/instances.ts
 *
 * Singleton service instances shared across routes, scheduler and tests.
 * Importing this file from routes gives them access to the same EmergencyService
 * instance that is wired to the ranking provider.
 */

import { EmergencyService } from "./EmergencyService";
import { StraightLineRankingProvider } from "./ranking/StraightLineRankingProvider";

export const emergencyService = new EmergencyService(new StraightLineRankingProvider());
