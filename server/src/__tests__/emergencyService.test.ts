/**
 * emergencyService.test.ts
 *
 * Spec acceptance criteria:
 *   ✓ Every valid transition passes
 *   ✓ Every invalid transition throws EmergencyError('INVALID_TRANSITION')
 *   ✓ Two concurrent approvals for the last bed → exactly one succeeds
 *   ✓ Hospital timeout moves to the next hospital
 *   ✓ Duplicate Idempotency-Key returns the same emergency
 *   ✓ Audit log is written on every state transition
 */

// ── Mock Prisma before any imports ────────────────────────────────────────────
jest.mock("../lib/prisma", () => ({
  prisma: {
    emergency: {
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
    },
    hospital: { findMany: jest.fn() },
    bedHold: {
      findFirst:   jest.fn(),
      create:      jest.fn(),
      update:      jest.fn(),
      updateMany:  jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { EmergencyService }               from "../services/EmergencyService";
import { StraightLineRankingProvider }    from "../services/ranking/StraightLineRankingProvider";
import { EmergencyError }                 from "../errors/EmergencyError";
import { prisma }                         from "../lib/prisma";

// ── Typed mock helpers ────────────────────────────────────────────────────────
const mEm  = prisma.emergency  as jest.Mocked<typeof prisma.emergency>;
const mBH  = prisma.bedHold    as jest.Mocked<typeof prisma.bedHold>;
const mHosp= prisma.hospital   as jest.Mocked<typeof prisma.hospital>;
const mAudit = prisma.auditLog as jest.Mocked<typeof prisma.auditLog>;
const mTx  = prisma.$transaction as jest.Mock;
const mRaw = prisma.$executeRaw  as jest.Mock;

// ── Common test data ──────────────────────────────────────────────────────────
const RANKED = [
  { hospitalId: "h1", distanceMeters: 1_000, etaSeconds: 100 },
  { hospitalId: "h2", distanceMeters: 2_000, etaSeconds: 200 },
  { hospitalId: "h3", distanceMeters: 3_000, etaSeconds: 300 },
];

const BASE_EM = {
  id:               "e1",
  driverId:         "u-driver",
  status:           "PENDING_APPROVALS" as string,
  severity:         "CRITICAL" as string,
  originLat:        12.97,
  originLng:        77.59,
  photoPath:        "/uploads/p.jpg",
  note:             null as string | null,
  selectedHospitalId: "h1" as string | null,
  hospitalAttempt:  0,
  rankedHospitals:  RANKED as unknown,
  policeStatus:     "PENDING" as string,
  hospitalStatus:   "PENDING" as string,
  policeDeadline:   new Date(Date.now() + 30_000) as Date | null,
  hospitalDeadline: new Date(Date.now() + 15_000) as Date | null,
  policeEscalated:  false,
  routeGeoJson:     null as unknown,
  etaSeconds:       100 as number | null,
  distanceMeters:   1_000 as number | null,
  idempotencyKey:   "key-1",
  city:             null as string | null,
  createdAt:        new Date(),
  closedAt:         null as Date | null,
};

const mkEm = (overrides: Partial<typeof BASE_EM> = {}) => ({ ...BASE_EM, ...overrides });

// ── Service setup ─────────────────────────────────────────────────────────────
const ranking = new StraightLineRankingProvider();
let svc: EmergencyService;

beforeEach(() => {
  jest.clearAllMocks();
  svc = new EmergencyService(ranking);

  // Default $transaction mock: interactive form passes through to a proxy tx
  type TxClient = { emergency: typeof mEm; bedHold: typeof mBH; hospital: typeof mHosp; $executeRaw: typeof mRaw };
  mTx.mockImplementation(async (fnOrArray: unknown) => {
    if (typeof fnOrArray === "function") {
      const tx: TxClient = {
        emergency: mEm,
        bedHold:   mBH,
        hospital:  mHosp,
        $executeRaw: mRaw,
      };
      return (fnOrArray as (tx: TxClient) => Promise<unknown>)(tx);
    }
    return Promise.all(fnOrArray as Promise<unknown>[]);
  });

  // Default audit always resolves
  (mAudit.create as jest.Mock).mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
describe("create()", () => {
  const createDto = {
    driverId:       "u-driver",
    severity:       "CRITICAL" as const,
    originLat:      12.97,
    originLng:      77.59,
    photoPath:      "/uploads/p.jpg",
    idempotencyKey: "key-1",
  };

  const hospitals = [
    { id: "h1", lat: 12.98, lng: 77.60, availableBeds: 3 },
    { id: "h2", lat: 12.99, lng: 77.61, availableBeds: 1 },
  ];

  test("creates emergency and writes audit log", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(null);
    (mHosp.findMany as jest.Mock).mockResolvedValue(hospitals);
    (mEm.create as jest.Mock).mockResolvedValue(mkEm());

    const result = await svc.create(createDto);

    expect(result.id).toBe("e1");
    expect(mEm.create).toHaveBeenCalledTimes(1);
    // Audit log must be written
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "EMERGENCY_CREATED" }) })
    );
  });

  test("duplicate idempotency key returns existing emergency without creating", async () => {
    const existing = mkEm();
    (mEm.findUnique as jest.Mock).mockResolvedValue(existing);

    const result = await svc.create(createDto);

    expect(result).toBe(existing);
    expect(mEm.create).not.toHaveBeenCalled();
    expect(mHosp.findMany).not.toHaveBeenCalled();
  });

  test("throws NO_HOSPITALS_FOUND when no hospitals have beds", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(null);
    (mHosp.findMany as jest.Mock).mockResolvedValue([
      { id: "h1", lat: 12.98, lng: 77.60, availableBeds: 0 },
    ]);

    await expect(svc.create(createDto)).rejects.toMatchObject({
      code: "NO_HOSPITALS_FOUND",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POLICE APPROVE
// ─────────────────────────────────────────────────────────────────────────────
describe("policeApprove()", () => {
  test("sets policeStatus=APPROVED; status stays PENDING_APPROVALS if hospital not yet approved", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ hospitalStatus: "PENDING" }));
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ policeStatus: "APPROVED" }));

    const result = await svc.policeApprove("e1", "officer-1");

    expect(mEm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ policeStatus: "APPROVED", status: "PENDING_APPROVALS" }),
      })
    );
    expect(mAudit.create).toHaveBeenCalled();
    expect(result.policeStatus).toBe("APPROVED");
  });

  test("sets status=ACTIVE when hospital had already approved", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(
      mkEm({ policeStatus: "PENDING", hospitalStatus: "APPROVED" })
    );
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ policeStatus: "APPROVED", status: "ACTIVE" }));

    await svc.policeApprove("e1", "officer-1");

    expect(mEm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  test("throws INVALID_TRANSITION if policeStatus is already APPROVED", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ policeStatus: "APPROVED" }));

    await expect(svc.policeApprove("e1", "officer-1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(mEm.update).not.toHaveBeenCalled();
  });

  test("throws INVALID_TRANSITION if emergency is REJECTED", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status: "REJECTED" }));

    await expect(svc.policeApprove("e1", "officer-1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POLICE REJECT
// ─────────────────────────────────────────────────────────────────────────────
describe("policeReject()", () => {
  test("sets status=REJECTED and writes audit log", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm());
    (mBH.findFirst as jest.Mock).mockResolvedValue(null); // no bed hold
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ status: "REJECTED", policeStatus: "REJECTED" }));

    const result = await svc.policeReject("e1", "officer-1");

    expect(mEm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REJECTED", policeStatus: "REJECTED" }),
      })
    );
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "POLICE_REJECTED" }) })
    );
    expect(result.status).toBe("REJECTED");
  });

  test("releases bed hold if hospital had already approved before police rejected", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm());
    (mBH.findFirst as jest.Mock).mockResolvedValue({ id: "bh1", hospitalId: "h1", emergencyId: "e1" });
    (mBH.update as jest.Mock).mockResolvedValue({});
    mRaw.mockResolvedValue(1);
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ status: "REJECTED" }));

    await svc.policeReject("e1", "officer-1");

    expect(mTx).toHaveBeenCalled(); // transaction for bed release
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOSPITAL APPROVE
// ─────────────────────────────────────────────────────────────────────────────
describe("hospitalApprove()", () => {
  test("decrements bed, creates bed hold, sets hospitalStatus=APPROVED", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm());
    mRaw.mockResolvedValue(1); // 1 bed decremented
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ hospitalStatus: "APPROVED" }));
    (mBH.create as jest.Mock).mockResolvedValue({ id: "bh1" });

    await svc.hospitalApprove("e1", "admin-h1", "h1");

    expect(mTx).toHaveBeenCalled();
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "HOSPITAL_APPROVED" }) })
    );
  });

  test("sets status=ACTIVE when police had already approved", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ policeStatus: "APPROVED" }));
    mRaw.mockResolvedValue(1);
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ hospitalStatus: "APPROVED", status: "ACTIVE" }));
    (mBH.create as jest.Mock).mockResolvedValue({ id: "bh1" });

    await svc.hospitalApprove("e1", "admin-h1", "h1");

    expect(mEm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  test("throws WRONG_HOSPITAL if caller hospital != selectedHospitalId", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ selectedHospitalId: "h1" }));

    await expect(svc.hospitalApprove("e1", "admin-h2", "h2")).rejects.toMatchObject({
      code: "WRONG_HOSPITAL",
    });
    expect(mTx).not.toHaveBeenCalled();
  });

  test("throws INVALID_TRANSITION if hospitalStatus already APPROVED", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ hospitalStatus: "APPROVED" }));

    await expect(svc.hospitalApprove("e1", "admin-h1", "h1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  // ── Concurrent last-bed test ─────────────────────────────────────────────
  test("concurrent approvals for the last bed → exactly one succeeds", async () => {
    // Both callers see the same emergency (PENDING)
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm());

    // First $executeRaw: 1 bed decremented (wins)
    // Second $executeRaw: 0 rows (no beds left → loses)
    mRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ hospitalStatus: "APPROVED" }));
    (mBH.create as jest.Mock).mockResolvedValue({ id: "bh1" });

    const [r1, r2] = await Promise.allSettled([
      svc.hospitalApprove("e1", "admin-h1-tab1", "h1"),
      svc.hospitalApprove("e1", "admin-h1-tab2", "h1"),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected  = [r1, r2].filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "NO_BEDS_AVAILABLE",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOSPITAL REJECT → auto-assign next hospital
// ─────────────────────────────────────────────────────────────────────────────
describe("hospitalReject()", () => {
  test("assigns next hospital in ranked list", async () => {
    const em = mkEm({ hospitalAttempt: 0, rankedHospitals: RANKED });
    (mEm.findUnique as jest.Mock)
      .mockResolvedValueOnce(em)   // assert()
      .mockResolvedValueOnce(em);  // assignNextHospital()

    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ selectedHospitalId: "h2", hospitalAttempt: 1 }));

    const result = await svc.hospitalReject("e1", "admin-h1", "h1");

    // Should have called update twice: once for REJECTED, once for reassignment
    expect(mEm.update).toHaveBeenCalledTimes(2);
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "HOSPITAL_REASSIGNED" }) })
    );
  });

  test("sets status=EXPIRED when all hospitals exhausted", async () => {
    // Only one hospital in ranked list — rejecting it exhausts all options
    const ranked = [{ hospitalId: "h1", distanceMeters: 1_000, etaSeconds: 100 }];
    const em = mkEm({ hospitalAttempt: 0, rankedHospitals: ranked });

    (mEm.findUnique as jest.Mock)
      .mockResolvedValueOnce(em)  // assert()
      .mockResolvedValueOnce(em); // assignNextHospital()

    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ status: "EXPIRED" }));

    const result = await svc.hospitalReject("e1", "admin-h1", "h1");

    const lastUpdate = (mEm.update as jest.Mock).mock.calls.at(-1)![0];
    expect(lastUpdate.data).toMatchObject({ status: "EXPIRED" });
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "EMERGENCY_EXPIRED" }) })
    );
  });

  test("throws WRONG_HOSPITAL if caller != selected hospital", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ selectedHospitalId: "h1" }));

    await expect(svc.hospitalReject("e1", "admin-h2", "h2")).rejects.toMatchObject({
      code: "WRONG_HOSPITAL",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOSPITAL REVOKE
// ─────────────────────────────────────────────────────────────────────────────
describe("hospitalRevoke()", () => {
  test("releases bed hold and assigns next hospital", async () => {
    const em = mkEm({ status: "ACTIVE", hospitalStatus: "APPROVED" });
    (mEm.findUnique as jest.Mock)
      .mockResolvedValueOnce(em)  // assert()
      .mockResolvedValueOnce(em)  // assignNextHospital()
      .mockResolvedValueOnce(em); // findFirst / releaseBedHold findOrThrow...

    (mBH.findFirst as jest.Mock).mockResolvedValue({ id: "bh1", hospitalId: "h1" });
    (mBH.update   as jest.Mock).mockResolvedValue({});
    mRaw.mockResolvedValue(1);
    (mEm.update   as jest.Mock).mockResolvedValue(mkEm({ selectedHospitalId: "h2" }));

    await svc.hospitalRevoke("e1", "admin-h1", "h1");

    expect(mTx).toHaveBeenCalled(); // bed release transaction
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "HOSPITAL_REVOKED" }) })
    );
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "HOSPITAL_REASSIGNED" }) })
    );
  });

  test("throws INVALID_TRANSITION if hospitalStatus != APPROVED", async () => {
    // Reset findUnique to clear any queued mockResolvedValueOnce from the prior test
    (mEm.findUnique as jest.Mock).mockReset().mockResolvedValue(
      mkEm({ selectedHospitalId: "h1", hospitalStatus: "PENDING", status: "PENDING_APPROVALS" })
    );
    (mAudit.create as jest.Mock).mockResolvedValue({});

    await expect(svc.hospitalRevoke("e1", "admin-h1", "h1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL
// ─────────────────────────────────────────────────────────────────────────────
describe("cancel()", () => {
  test("cancels from PENDING_APPROVALS", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm());
    (mBH.findFirst as jest.Mock).mockResolvedValue(null);
    (mEm.update    as jest.Mock).mockResolvedValue(mkEm({ status: "CANCELLED" }));

    const result = await svc.cancel("e1", "u-driver");

    expect(result.status).toBe("CANCELLED");
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "EMERGENCY_CANCELLED" }) })
    );
  });

  test("releases bed hold when cancelling from ACTIVE", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status: "ACTIVE", hospitalStatus: "APPROVED" }));
    (mBH.findFirst as jest.Mock).mockResolvedValue({ id: "bh1", hospitalId: "h1" });
    (mBH.update    as jest.Mock).mockResolvedValue({});
    mRaw.mockResolvedValue(1);
    (mEm.update    as jest.Mock).mockResolvedValue(mkEm({ status: "CANCELLED" }));

    await svc.cancel("e1", "u-driver");

    expect(mTx).toHaveBeenCalled();
  });

  test("throws INVALID_TRANSITION when already in terminal state", async () => {
    for (const status of ["CLOSED", "REJECTED", "EXPIRED", "CANCELLED"] as const) {
      (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status }));
      await expect(svc.cancel("e1", "u-driver")).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ARRIVED
// ─────────────────────────────────────────────────────────────────────────────
describe("arrived()", () => {
  test("transitions ACTIVE → ARRIVED and consumes bed hold", async () => {
    (mEm.findUnique  as jest.Mock).mockResolvedValue(mkEm({ status: "ACTIVE" }));
    (mEm.update      as jest.Mock).mockResolvedValue(mkEm({ status: "ARRIVED" }));
    (mBH.updateMany  as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await svc.arrived("e1", "u-driver");

    expect(result.status).toBe("ARRIVED");
    expect(mBH.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONSUMED" } })
    );
  });

  test("throws INVALID_TRANSITION if not ACTIVE", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status: "PENDING_APPROVALS" }));

    await expect(svc.arrived("e1", "u-driver")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRM HANDOVER
// ─────────────────────────────────────────────────────────────────────────────
describe("confirmHandover()", () => {
  test("transitions ARRIVED → CLOSED", async () => {
    (mEm.findUnique  as jest.Mock).mockResolvedValue(mkEm({ status: "ARRIVED" }));
    (mEm.update      as jest.Mock).mockResolvedValue(mkEm({ status: "CLOSED" }));
    (mBH.updateMany  as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await svc.confirmHandover("e1", "admin-h1", "h1");

    expect(result.status).toBe("CLOSED");
    expect(mAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "HANDOVER_CONFIRMED" }) })
    );
  });

  test("throws WRONG_HOSPITAL if confirming hospital != selectedHospitalId", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status: "ARRIVED", selectedHospitalId: "h1" }));

    await expect(svc.confirmHandover("e1", "admin-h2", "h2")).rejects.toMatchObject({
      code: "WRONG_HOSPITAL",
    });
  });

  test("throws INVALID_TRANSITION if not ARRIVED", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status: "ACTIVE" }));

    await expect(svc.confirmHandover("e1", "admin-h1", "h1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOSPITAL TIMEOUT (scheduler path)
// ─────────────────────────────────────────────────────────────────────────────
describe("hospitalTimeout()", () => {
  test("moves to next hospital when one exists", async () => {
    const em = mkEm({ hospitalAttempt: 0, rankedHospitals: RANKED });
    (mEm.findUnique as jest.Mock)
      .mockResolvedValueOnce(em)  // findOrThrow in hospitalTimeout
      .mockResolvedValueOnce(em); // findOrThrow in assignNextHospital

    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ selectedHospitalId: "h2", hospitalAttempt: 1 }));

    await svc.hospitalTimeout("e1");

    const allAuditActions = (mAudit.create as jest.Mock).mock.calls.map(
      (c: [{ data: { action: string } }]) => c[0].data.action
    );
    expect(allAuditActions).toContain("HOSPITAL_TIMED_OUT");
    expect(allAuditActions).toContain("HOSPITAL_REASSIGNED");
  });

  test("sets status=EXPIRED when last hospital times out", async () => {
    const ranked = [{ hospitalId: "h1", distanceMeters: 1_000, etaSeconds: 100 }];
    const em = mkEm({ hospitalAttempt: 0, rankedHospitals: ranked });

    (mEm.findUnique as jest.Mock)
      .mockResolvedValueOnce(em)
      .mockResolvedValueOnce(em);
    (mEm.update as jest.Mock).mockResolvedValue(mkEm({ status: "EXPIRED" }));

    await svc.hospitalTimeout("e1");

    const lastUpdate = (mEm.update as jest.Mock).mock.calls.at(-1)![0];
    expect(lastUpdate.data).toMatchObject({ status: "EXPIRED" });
  });

  test("is idempotent if emergency already moved past PENDING_APPROVALS", async () => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(mkEm({ status: "ACTIVE" }));

    // Should not call update at all
    await svc.hospitalTimeout("e1");

    expect(mEm.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMERGENCY_NOT_FOUND
// ─────────────────────────────────────────────────────────────────────────────
describe("EMERGENCY_NOT_FOUND", () => {
  test.each([
    ["policeApprove",   () => svc.policeApprove("bad", "actor")],
    ["policeReject",    () => svc.policeReject("bad", "actor")],
    ["hospitalApprove", () => svc.hospitalApprove("bad", "actor", "h1")],
    ["hospitalReject",  () => svc.hospitalReject("bad", "actor", "h1")],
    ["cancel",          () => svc.cancel("bad", "actor")],
    ["arrived",         () => svc.arrived("bad", "actor")],
    ["confirmHandover", () => svc.confirmHandover("bad", "actor", "h1")],
    ["hospitalTimeout", () => svc.hospitalTimeout("bad")],
  ])("%s throws EMERGENCY_NOT_FOUND", async (_name, call) => {
    (mEm.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({ code: "EMERGENCY_NOT_FOUND" });
  });
});
