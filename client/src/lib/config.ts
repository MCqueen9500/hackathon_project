/** Horizontal GPS accuracy ceiling (metres). From GPS_MAX_ACCURACY_M env. */
export const GPS_MAX_ACCURACY_M = Number(import.meta.env.VITE_GPS_MAX_ACCURACY_M ?? 50) || 50;
