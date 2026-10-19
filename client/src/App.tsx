/**
 * Top-level router with auth guards.
 *
 * Route structure:
 *   /              → redirect to /login
 *   /login         → LoginPage (public)
 *   /driver/*      → ProtectedRoute(DRIVER)   → DriverPage
 *   /police/*      → ProtectedRoute(POLICE)   → PolicePage
 *   /hospital/*    → ProtectedRoute(HOSPITAL_ADMIN) → HospitalPage
 *   *              → NotFoundPage
 *
 * Role enforcement:
 *   - Unauthenticated → /login
 *   - Wrong role (e.g. DRIVER hits /police) → own dashboard (/driver)
 */

import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import LoginPage    from "./pages/LoginPage";
import DriverPage   from "./pages/DriverPage";
import PolicePage   from "./pages/PolicePage";
import HospitalPage from "./pages/HospitalPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      {/* Root → login */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Role-gated routes */}
      <Route element={<ProtectedRoute allowedRole="DRIVER" />}>
        <Route path="/driver/*" element={<DriverPage />} />
      </Route>

      <Route element={<ProtectedRoute allowedRole="POLICE" />}>
        <Route path="/police/*" element={<PolicePage />} />
      </Route>

      <Route element={<ProtectedRoute allowedRole="HOSPITAL_ADMIN" />}>
        <Route path="/hospital/*" element={<HospitalPage />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
