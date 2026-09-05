-- Replace the user-chosen commit time with a commit count.
-- Slot times are now derived (one commit per hour) in the application layer.
ALTER TABLE "schedules" DROP COLUMN "timeOfDay";
ALTER TABLE "schedules" ADD COLUMN "commitsPerDay" INTEGER NOT NULL DEFAULT 1;
