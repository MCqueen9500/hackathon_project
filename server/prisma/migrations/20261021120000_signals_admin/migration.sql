-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "signals" ADD COLUMN "simulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "signals" ADD COLUMN "osmId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "signals_osmId_key" ON "signals"("osmId");
