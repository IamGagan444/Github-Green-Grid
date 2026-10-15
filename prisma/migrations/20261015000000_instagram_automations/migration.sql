-- CreateEnum
CREATE TYPE "InstagramTrigger" AS ENUM ('COMMENT', 'DM_KEYWORD', 'STORY_REPLY', 'STORY_MENTION');

-- CreateEnum
CREATE TYPE "KeywordMatch" AS ENUM ('CONTAINS', 'EXACT', 'ANY');

-- CreateEnum
CREATE TYPE "InstagramEventType" AS ENUM ('COMMENT', 'MESSAGE', 'STORY_REPLY', 'STORY_MENTION', 'POSTBACK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_DISCONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_AUTOMATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_AUTOMATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_AUTOMATION_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_AUTOMATION_RESUMED';
ALTER TYPE "AuditAction" ADD VALUE 'INSTAGRAM_AUTOMATION_DELETED';

-- CreateTable
CREATE TABLE "instagram_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "appScopedId" TEXT,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "profilePictureUrl" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "accessTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhookSubscribedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_automations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
    "trigger" "InstagramTrigger" NOT NULL,
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchMode" "KeywordMatch" NOT NULL DEFAULT 'CONTAINS',
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicReplies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dmMessage" TEXT NOT NULL,
    "linkUrl" TEXT,
    "linkButtonLabel" TEXT NOT NULL DEFAULT 'Open link',
    "followGateEnabled" BOOLEAN NOT NULL DEFAULT false,
    "followGateMessage" TEXT NOT NULL DEFAULT 'Follow us first, then tap the button below to get the link 👇',
    "followButtonLabel" TEXT NOT NULL DEFAULT 'I''m following ✅',
    "triggeredCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_events" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "automationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "type" "InstagramEventType" NOT NULL,
    "senderIgsid" TEXT NOT NULL,
    "senderUsername" TEXT,
    "sourceId" TEXT NOT NULL,
    "mediaId" TEXT,
    "text" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "publicReplyStatus" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "dmStatus" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "linkStatus" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "publicReplyId" TEXT,
    "dmMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "instagram_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instagram_integrations_igUserId_key" ON "instagram_integrations"("igUserId");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_integrations_appScopedId_key" ON "instagram_integrations"("appScopedId");

-- CreateIndex
CREATE INDEX "instagram_integrations_userId_idx" ON "instagram_integrations"("userId");

-- CreateIndex
CREATE INDEX "instagram_integrations_status_idx" ON "instagram_integrations"("status");

-- CreateIndex
CREATE INDEX "instagram_integrations_tokenExpiresAt_idx" ON "instagram_integrations"("tokenExpiresAt");

-- CreateIndex
CREATE INDEX "instagram_automations_userId_idx" ON "instagram_automations"("userId");

-- CreateIndex
CREATE INDEX "instagram_automations_integrationId_status_trigger_idx" ON "instagram_automations"("integrationId", "status", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_events_idempotencyKey_key" ON "instagram_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "instagram_events_integrationId_createdAt_idx" ON "instagram_events"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "instagram_events_automationId_createdAt_idx" ON "instagram_events"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "instagram_events_status_nextRetryAt_idx" ON "instagram_events"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "instagram_events_integrationId_senderIgsid_idx" ON "instagram_events"("integrationId", "senderIgsid");

-- AddForeignKey
ALTER TABLE "instagram_integrations" ADD CONSTRAINT "instagram_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_automations" ADD CONSTRAINT "instagram_automations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_automations" ADD CONSTRAINT "instagram_automations_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "instagram_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_events" ADD CONSTRAINT "instagram_events_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "instagram_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_events" ADD CONSTRAINT "instagram_events_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "instagram_automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

