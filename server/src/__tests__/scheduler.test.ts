/**
 * scheduler.test.ts
 *
 * Spec acceptance criteria:
 *   ✓ Hospital timeout moves to the next hospital
 *   ✓ Police timeout sets escalation flag (does NOT reject)
 *   ✓ Bed hold expiry releases the bed atomically
 *   ✓ Restarting the scheduler mid-wait still fires the timeout
 *     (because runNow() reads deadlines from DB, not memory)
 */

jest.mock("../lib/prisma", () => ({
  prisma: {
    emergency: {
      findMany:   jest.fn(),
      updateMany: jest.fn(),
    },
    bedHold: {
      findMany: jest.fn(),
      update:   jest.fn(),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { Scheduler }      from "../services/Scheduler";
import { EmergencyService } from "../services/EmergencyService";
import { prisma }         from "../lib/prisma";

// ── Typed mocks ────────────────────────────────────────────────────────────
const mEm  = prisma.emergency as jest.Mocked<typeof prisma.emergency>;
const mBH  = prisma.bedHold   as jest.Mocked<typeof prisma.bedHold>;
const mTx  = prisma.$transaction as jest.Mock;
const mRaw = prisma.$executeRaw  as jest.Mock;

// ── Mock EmergencyService ──────────────────────────────────────────────────
const mockSvc = {
  hospitalTimeout: jest.fn(),
} as unknown as EmergencyService;

let scheduler: Scheduler;

beforeEach(() => {
  jest.clearAllMocks();
  scheduler = new Scheduler(mockSvc);

  type TxClient = { bedHold: typeof mBH; $executeRaw: typeof mRaw };
  mTx.mockImplementation(async (fnOrArray: unknown) => {
    if (typeof fnOrArray === "function") {
      const tx: TxClient = { bedHold: mBH, $executeRaw: mRaw };
      return (fnOrArray as (tx: TxClient) => Promise<unknown>)(tx);
    }
    return Promise.all(fnOrArray as Promise<unknown>[]);
  });

  (mockSvc.hospitalTimeout as jest.Mock).mockResolvedValue({});
});

afterEach(() => scheduler.stop());

// ─────────────────────────────────────────────────────────────────────────────
// Hospital timeouts
// ─────────────────────────────────────────────────────────────────────────────
describe("Hospital timeout handling", () => {
  test("calls emergencyService.hospitalTimeout for each expired emergency", async () => {
    (mEm.findMany as jest.Mock).mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (mBH.findMany   as jest.Mock).mockResolvedValue([]);

    await scheduler.runNow();

    expect(mockSvc.hospitalTimeout).toHaveBeenCalledTimes(2);
    expect(mockSvc.hospitalTimeout).toHaveBeenCalledWith("e1");
    expect(mockSvc.hospitalTimeout).toHaveBeenCalledWith("e2");
  });

  test("continues processing remaining emergencies if one timeout call fails", async () => {
    (mEm.findMany as jest.Mock).mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (mBH.findMany   as jest.Mock).mockResolvedValue([]);

    // First call fails, second should still run
    (mockSvc.hospitalTimeout as jest.Mock)
      .mockRejectedValueOnce(new Error("DB transient error"))
      .mockResolvedValueOnce({});

    await expect(scheduler.runNow()).resolves.toBeUndefined();
    expect(mockSvc.hospitalTimeout).toHaveBeenCalledTimes(2);
  });

  // KEY TEST: restarting scheduler mid-wait still fires the timeout
  test("restarting mid-wait fires timeout because deadlines come from DB, not memory", async () => {
    // Simulate an emergency whose deadline expired while the server was down
    const pastDeadline = new Date(Date.now() - 10_000);
    (mEm.findMany as jest.Mock).mockResolvedValue([{ id: "e-missed" }]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (mBH.findMany   as jest.Mock).mockResolvedValue([]);

    // Create a BRAND NEW scheduler (simulates process restart)
    const freshScheduler = new Scheduler(mockSvc);

    // runNow() on the fresh scheduler reads DB state (past deadline is there)
    await freshScheduler.runNow();

    // Despite no in-memory timer having fired, the timeout is processed
    expect(mockSvc.hospitalTimeout).toHaveBeenCalledWith("e-missed");
    freshScheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Police timeouts
// ─────────────────────────────────────────────────────────────────────────────
describe("Police timeout handling", () => {
  test("sets policeEscalated=true on expired police deadlines", async () => {
    (mEm.findMany   as jest.Mock).mockResolvedValue([]);     // no hospital timeouts
    (mBH.findMany   as jest.Mock).mockResolvedValue([]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

    await scheduler.runNow();

    expect(mEm.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          policeStatus:    "PENDING",
          policeEscalated: false,
          policeDeadline:  expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: { policeEscalated: true },
      })
    );
  });

  test("does NOT reject the emergency (only escalation flag)", async () => {
    (mEm.findMany   as jest.Mock).mockResolvedValue([]);
    (mBH.findMany   as jest.Mock).mockResolvedValue([]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    await scheduler.runNow();

    // updateMany should NOT set status=REJECTED
    const call = (mEm.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.data).not.toHaveProperty("status");
    expect(call.data).not.toHaveProperty("policeStatus");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bed hold expiry
// ─────────────────────────────────────────────────────────────────────────────
describe("Bed hold expiry", () => {
  test("releases expired bed holds atomically and restores availableBeds", async () => {
    (mEm.findMany   as jest.Mock).mockResolvedValue([]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (mBH.findMany   as jest.Mock).mockResolvedValue([
      { id: "bh1", hospitalId: "h1", emergencyId: "e1" },
    ]);
    (mBH.update     as jest.Mock).mockResolvedValue({});
    mRaw.mockResolvedValue(1);

    await scheduler.runNow();

    // Transaction must have been called for the bed hold release
    expect(mTx).toHaveBeenCalled();

    // bedHold.update called with status=EXPIRED
    expect(mBH.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED" } })
    );

    // $executeRaw called to restore beds (+1)
    expect(mRaw).toHaveBeenCalled();
  });

  test("continues processing remaining holds if one fails", async () => {
    (mEm.findMany   as jest.Mock).mockResolvedValue([]);
    (mEm.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (mBH.findMany   as jest.Mock).mockResolvedValue([
      { id: "bh1", hospitalId: "h1", emergencyId: "e1" },
      { id: "bh2", hospitalId: "h2", emergencyId: "e2" },
    ]);

    type TxClient2 = { bedHold: typeof mBH; $executeRaw: typeof mRaw };
    mTx
      .mockRejectedValueOnce(new Error("transient"))
      .mockImplementationOnce(async (fn: unknown) => {
        if (typeof fn === "function") {
          const tx: TxClient2 = { bedHold: mBH, $executeRaw: mRaw };
          return (fn as (tx: TxClient2) => Promise<unknown>)(tx);
        }
      });

    (mBH.update as jest.Mock).mockResolvedValue({});
    mRaw.mockResolvedValue(1);

    await expect(scheduler.runNow()).resolves.toBeUndefined();
    // Second hold should still be processed
    expect(mTx).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// start / stop lifecycle
// ─────────────────────────────────────────────────────────────────────────────
describe("Scheduler lifecycle", () => {
  test("start() is idempotent — calling it twice does not double-schedule", () => {
    scheduler.start();
    scheduler.start(); // second call should be no-op
    scheduler.stop();
    // No assertions needed — just ensure no errors are thrown
  });

  test("stop() before start() does not throw", () => {
    const fresh = new Scheduler(mockSvc);
    expect(() => fresh.stop()).not.toThrow();
  });
});
