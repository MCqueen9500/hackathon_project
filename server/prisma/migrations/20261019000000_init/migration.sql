-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DRIVER', 'HOSPITAL_ADMIN', 'POLICE');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('PENDING_APPROVALS', 'ACTIVE', 'ARRIVED', 'CLOSED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'SERIOUS', 'STABLE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "BedHoldStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'SIMULATOR');

-- CreateTable
CREATE TABLE "hospitals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "city" TEXT,
    "specialties" TEXT[],
    "totalEmergencyBeds" INTEGER NOT NULL DEFAULT 0,
    "availableBeds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "hospitalId" TEXT,
    "ambulanceNo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergencies" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'PENDING_APPROVALS',
    "severity" "Severity" NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "photoPath" TEXT NOT NULL,
    "note" TEXT,
    "selectedHospitalId" TEXT,
    "hospitalAttempt" INTEGER NOT NULL DEFAULT 0,
    "rankedHospitals" JSONB,
    "policeStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "hospitalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "policeDeadline" TIMESTAMP(3),
    "hospitalDeadline" TIMESTAMP(3),
    "policeEscalated" BOOLEAN NOT NULL DEFAULT false,
    "routeGeoJson" JSONB,
    "etaSeconds" INTEGER,
    "distanceMeters" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "emergencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_holds" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "status" "BedHoldStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bed_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_pings" (
    "id" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "source" "LocationSource" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_closures" (
    "id" TEXT NOT NULL,
    "polygonGeoJson" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "road_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "city" TEXT,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "emergencies_idempotencyKey_key" ON "emergencies"("idempotencyKey");

-- CreateIndex
CREATE INDEX "location_pings_emergencyId_recordedAt_idx" ON "location_pings"("emergencyId", "recordedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_selectedHospitalId_fkey" FOREIGN KEY ("selectedHospitalId") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_holds" ADD CONSTRAINT "bed_holds_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_holds" ADD CONSTRAINT "bed_holds_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "emergencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "emergencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_closures" ADD CONSTRAINT "road_closures_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
