/**
 * /hospital — hospital admin interface (Phase 0 stub)
 * Full implementation: incoming requests, bed counter, driver mgmt, handover — Phase 2+
 */
export default function HospitalPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="text-center">
        <div className="text-5xl mb-4">🏥</div>
        <h1 className="text-2xl font-bold text-white mb-2">
          Hospital Dashboard
        </h1>
        <p className="text-gray-400 text-sm">
          Approve requests · Manage beds · Confirm handover
        </p>
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-purple-900 border border-purple-700 rounded-full text-purple-400 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          Phase 0 — scaffold ready
        </div>
      </div>
    </div>
  );
}
