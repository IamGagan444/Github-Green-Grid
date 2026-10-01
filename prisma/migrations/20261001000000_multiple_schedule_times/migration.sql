-- Multiple post times per day per automation (1–24).

-- Automations: one schedule time -> a list, preserving each existing time.
ALTER TABLE "automations" ADD COLUMN "scheduleTimes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "automations" SET "scheduleTimes" = ARRAY["scheduleTime"];
ALTER TABLE "automations" ALTER COLUMN "scheduleTimes" DROP DEFAULT;
ALTER TABLE "automations" DROP COLUMN "scheduleTime";

-- Executions: which slot ran, and the exact commit range it summarised.
-- Existing rows keep their "<automationId>:<date>" keys; new keys add the slot.
ALTER TABLE "executions" ADD COLUMN "slot" TEXT;
ALTER TABLE "executions" ADD COLUMN "windowStart" TIMESTAMP(3);
ALTER TABLE "executions" ADD COLUMN "windowEnd" TIMESTAMP(3);

CREATE INDEX "executions_automationId_executionDate_idx" ON "executions"("automationId", "executionDate");
