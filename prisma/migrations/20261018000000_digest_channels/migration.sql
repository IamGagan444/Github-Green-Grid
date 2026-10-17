-- AlterTable
ALTER TABLE "digest_settings" ADD COLUMN     "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
