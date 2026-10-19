import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ROLE_HOME } from "../components/ProtectedRoute";

export default function NotFoundPage() {
  const { user } = useAuth();
  const home = user ? ROLE_HOME[user.role] : "/login";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="text-center">
        <p className="text-8xl mb-4" aria-hidden>🚧</p>
        <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
        <p className="text-gray-400 text-sm mb-6">
          The page you're looking for doesn't exist or you don't have access.
        </p>
        <Link
          to={home}
          className="inline-block bg-egc-green-600 hover:bg-egc-green-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
        >
          {user ? "Back to dashboard" : "Back to login"}
        </Link>
      </div>
    </div>
  );
}
