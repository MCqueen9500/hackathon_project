/**
 * /driver — mobile-first driver interface (Phase 0 stub)
 * Full implementation: report accident, hospital picker, live map — Phase 2+
 */
export default function DriverPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="text-center">
        <div className="text-5xl mb-4">🚑</div>
        <h1 className="text-2xl font-bold text-white mb-2">Driver Dashboard</h1>
        <p className="text-gray-400 text-sm">
          Report accidents · Track corridor · Navigate
        </p>
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-egc-green-900 border border-egc-green-700 rounded-full text-egc-green-400 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-egc-green-400 animate-pulse" />
          Phase 0 — scaffold ready
        </div>
      </div>
    </div>
  );
}
