-- AlterTable
ALTER TABLE "reminder_settings" ADD COLUMN     "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
