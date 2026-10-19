import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DriverPage from "./pages/DriverPage";
import PolicePage from "./pages/PolicePage";
import HospitalPage from "./pages/HospitalPage";
import NotFoundPage from "./pages/NotFoundPage";

/**
 * Top-level router.
 * Role-gated routes (/driver, /police, /hospital) per spec section 3.
 * Auth guards will be added in Phase 1 when JWT auth is wired.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/driver/*" element={<DriverPage />} />
      <Route path="/police/*" element={<PolicePage />} />
      <Route path="/hospital/*" element={<HospitalPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
