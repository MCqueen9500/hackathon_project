/**
 * /police — police officer interface (Phase 0 stub)
 * Full implementation: verification queue, closures tool, corridors — Phase 2+
 */
export default function PolicePage() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="text-center">
        <div className="text-5xl mb-4">🚔</div>
        <h1 className="text-2xl font-bold text-white mb-2">Police Dashboard</h1>
        <p className="text-gray-400 text-sm">
          Verify emergencies · Manage road closures · Monitor corridors
        </p>
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-blue-900 border border-blue-700 rounded-full text-blue-400 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Phase 0 — scaffold ready
        </div>
      </div>
    </div>
  );
}
