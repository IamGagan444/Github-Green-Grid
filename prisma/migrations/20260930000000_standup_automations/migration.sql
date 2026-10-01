-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CommitWindow" AS ENUM ('SAME_DAY', 'PREVIOUS_DAY');

-- CreateEnum
CREATE TYPE "SlackPostingMode" AS ENUM ('BOT', 'USER');

-- CreateEnum
CREATE TYPE "MessageStyle" AS ENUM ('CONCISE', 'DETAILED', 'TECHNICAL', 'NON_TECHNICAL');

-- CreateEnum
CREATE TYPE "ThreadMode" AS ENUM ('DATE_HEADER', 'AI_PARENT', 'NO_THREAD');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_DISABLED', 'USER_ENABLED', 'GITHUB_CONNECTED', 'GITHUB_DISCONNECTED', 'SLACK_CONNECTED', 'SLACK_DISCONNECTED', 'AUTOMATION_CREATED', 'AUTOMATION_UPDATED', 'AUTOMATION_PAUSED', 'AUTOMATION_RESUMED', 'AUTOMATION_DELETED', 'AUTOMATION_TESTED', 'AUTOMATION_EXECUTED', 'AUTOMATION_FAILED', 'ADMIN_ACTION');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "defaultDaysOfWeek" "Weekday"[] DEFAULT ARRAY['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']::"Weekday"[],
ADD COLUMN     "defaultMessageStyle" "MessageStyle" NOT NULL DEFAULT 'CONCISE',
ADD COLUMN     "defaultScheduleTime" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailVerified" TIMESTAMP(3),
ADD COLUMN     "image" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- Rename github_accounts -> github_integrations, preserving connected accounts.
ALTER TABLE "github_accounts" RENAME TO "github_integrations";
ALTER TABLE "github_integrations" RENAME CONSTRAINT "github_accounts_pkey" TO "github_integrations_pkey";
ALTER TABLE "github_integrations" RENAME CONSTRAINT "github_accounts_userId_fkey" TO "github_integrations_userId_fkey";
ALTER INDEX "github_accounts_userId_key" RENAME TO "github_integrations_userId_key";
ALTER INDEX "github_accounts_githubUserId_key" RENAME TO "github_integrations_githubUserId_key";
ALTER INDEX "github_accounts_username_idx" RENAME TO "github_integrations_username_idx";
ALTER TABLE "github_integrations" ALTER COLUMN "accessTokenEncrypted" DROP NOT NULL,
ADD COLUMN "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
ADD COLUMN "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "disconnectedAt" TIMESTAMP(3);
UPDATE "github_integrations" SET "connectedAt" = "createdAt";

-- Sign-in moves from the custom GitHub session to Auth.js (Google). Sessions
-- minted by the old flow are invalidated.
DELETE FROM "sessions";

-- CreateTable
CREATE TABLE "slack_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamDomain" TEXT,
    "appId" TEXT,
    "authedUserId" TEXT NOT NULL,
    "botUserId" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "botTokenEncrypted" TEXT,
    "botRefreshTokenEncrypted" TEXT,
    "botTokenExpiresAt" TIMESTAMP(3),
    "botScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userTokenEncrypted" TEXT,
    "userRefreshTokenEncrypted" TEXT,
    "userTokenExpiresAt" TIMESTAMP(3),
    "userScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledReason" TEXT,
    "githubSources" JSONB NOT NULL,
    "commitWindow" "CommitWindow" NOT NULL DEFAULT 'SAME_DAY',
    "slackIntegrationId" TEXT,
    "slackChannelId" TEXT NOT NULL,
    "slackChannelName" TEXT NOT NULL,
    "postingMode" "SlackPostingMode" NOT NULL DEFAULT 'BOT',
    "messageStyle" "MessageStyle" NOT NULL DEFAULT 'CONCISE',
    "quickNote" TEXT,
    "includeFileStats" BOOLEAN NOT NULL DEFAULT false,
    "threadMode" "ThreadMode" NOT NULL DEFAULT 'DATE_HEADER',
    "headerFormat" TEXT NOT NULL DEFAULT '📅 {date}',
    "daysOfWeek" "Weekday"[],
    "scheduleTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "lastExecutionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "automationId" TEXT,
    "userId" TEXT NOT NULL,
    "automationName" TEXT NOT NULL,
    "executionDate" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "trigger" "RunTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "githubStatus" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "aiStatus" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "slackStatus" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "repositories" JSONB,
    "commitCount" INTEGER,
    "aiOutput" JSONB,
    "aiModel" TEXT,
    "messageText" TEXT,
    "slackTeamId" TEXT,
    "slackChannelId" TEXT,
    "slackChannelName" TEXT,
    "slackParentTs" TEXT,
    "slackReplyTs" TEXT,
    "slackPermalink" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_thread_anchors" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "anchorKey" TEXT NOT NULL,
    "parentTs" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_thread_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "github_integrations_status_idx" ON "github_integrations"("status");

-- CreateIndex
CREATE INDEX "slack_integrations_teamId_idx" ON "slack_integrations"("teamId");

-- CreateIndex
CREATE INDEX "slack_integrations_status_idx" ON "slack_integrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "slack_integrations_userId_teamId_key" ON "slack_integrations"("userId", "teamId");

-- CreateIndex
CREATE INDEX "automations_userId_idx" ON "automations"("userId");

-- CreateIndex
CREATE INDEX "automations_status_idx" ON "automations"("status");

-- CreateIndex
CREATE INDEX "automations_slackIntegrationId_idx" ON "automations"("slackIntegrationId");

-- CreateIndex
CREATE INDEX "automations_createdAt_idx" ON "automations"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "executions_idempotencyKey_key" ON "executions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "executions_userId_idx" ON "executions"("userId");

-- CreateIndex
CREATE INDEX "executions_automationId_idx" ON "executions"("automationId");

-- CreateIndex
CREATE INDEX "executions_status_idx" ON "executions"("status");

-- CreateIndex
CREATE INDEX "executions_executionDate_idx" ON "executions"("executionDate");

-- CreateIndex
CREATE INDEX "executions_createdAt_idx" ON "executions"("createdAt");

-- CreateIndex
CREATE INDEX "executions_status_nextRetryAt_idx" ON "executions"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "slack_thread_anchors_createdAt_idx" ON "slack_thread_anchors"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "slack_thread_anchors_teamId_channelId_dateKey_anchorKey_key" ON "slack_thread_anchors"("teamId", "channelId", "dateKey", "anchorKey");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "cron_runs_job_startedAt_idx" ON "cron_runs"("job", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_slackIntegrationId_fkey" FOREIGN KEY ("slackIntegrationId") REFERENCES "slack_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

