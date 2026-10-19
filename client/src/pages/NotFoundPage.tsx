import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="text-center">
        <div className="text-6xl font-bold text-gray-800 mb-4">404</div>
        <h1 className="text-xl font-semibold text-white mb-2">
          Page not found
        </h1>
        <p className="text-gray-400 text-sm mb-6">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 bg-egc-green-600 hover:bg-egc-green-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          Go to login
        </Link>
      </div>
    </div>
  );
}
