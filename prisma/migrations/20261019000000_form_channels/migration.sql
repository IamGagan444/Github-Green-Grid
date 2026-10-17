-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
