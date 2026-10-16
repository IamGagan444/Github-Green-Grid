-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('TELEGRAM', 'DISCORD_WEBHOOK', 'SLACK', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationSource" AS ENUM ('GITHUB', 'FORM', 'PAYMENT', 'UPTIME', 'DIGEST', 'REMINDER', 'CROSSPOST');

-- CreateEnum
CREATE TYPE "WorkflowKind" AS ENUM ('NOTIFY', 'FORM_SUBMISSION', 'REMINDER', 'DIGEST', 'CROSSPOST_DRAFT', 'CROSSPOST_PUBLISH');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'SUCCESS', 'FAILED', 'SKIPPED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeliverySemantics" AS ENUM ('AT_LEAST_ONCE', 'AT_MOST_ONCE');

-- CreateEnum
CREATE TYPE "MonitorState" AS ENUM ('UNKNOWN', 'UP', 'DOWN');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DigestSourceKind" AS ENUM ('RSS', 'YOUTUBE_CHANNEL', 'GITHUB_RELEASES', 'HACKER_NEWS');

-- CreateEnum
CREATE TYPE "CrossPostSourceKind" AS ENUM ('YOUTUBE', 'RSS');

-- CreateEnum
CREATE TYPE "CrossPostMode" AS ENUM ('APPROVAL', 'AUTO');

-- CreateEnum
CREATE TYPE "CrossPostItemStatus" AS ENUM ('NEW', 'AWAITING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PARTIAL', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "QuotaScope" AS ENUM ('YOUTUBE_UNITS', 'EMAILS', 'TELEGRAM_MESSAGES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TELEGRAM_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'TELEGRAM_DISCONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'GOOGLE_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'GOOGLE_DISCONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'GOOGLE_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'LINKEDIN_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'LINKEDIN_DISCONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'LINKEDIN_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'CHANNEL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CHANNEL_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'RULE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'RULE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_KEY_SAVED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_KEY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'MONITOR_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'MONITOR_DELETED';

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "label" TEXT NOT NULL,
    "configEncrypted" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "NotificationSource" NOT NULL,
    "filter" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rule_targets" (
    "ruleId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "notification_rule_targets_pkey" PRIMARY KEY ("ruleId","channelId")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "NotificationSource" NOT NULL,
    "type" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fannedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "WorkflowKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "input" JSONB,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "RunTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "semantics" "DeliverySemantics" NOT NULL DEFAULT 'AT_LEAST_ONCE',
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "result" JSONB,
    "externalId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "userId" TEXT,
    "accountId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repositorySelection" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "refreshTokenEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberSub" TEXT NOT NULL,
    "name" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "accessTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "expiryWarnedAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "keyEncrypted" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uptime_monitors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" "MonitorState" NOT NULL DEFAULT 'UNKNOWN',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastLatencyMs" INTEGER,
    "lastError" TEXT,
    "lastChangeAt" TIMESTAMP(3),
    "tlsExpiresAt" TIMESTAMP(3),
    "tlsCheckedAt" TIMESTAMP(3),
    "tlsAlertLevel" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uptime_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
    "fields" JSONB NOT NULL,
    "thankYouMessage" TEXT NOT NULL DEFAULT 'Thanks! We received your response.',
    "spreadsheetId" TEXT,
    "sheetUrl" TEXT,
    "ackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ackSubject" TEXT,
    "ackBody" TEXT,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "dueDate" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "paymentLink" TEXT,
    "intervalDays" INTEGER NOT NULL DEFAULT 3,
    "maxReminders" INTEGER NOT NULL DEFAULT 3,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "nextReminderOn" TEXT,
    "lastRemindedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "hour" INTEGER NOT NULL DEFAULT 10,
    "upiId" TEXT,
    "payeeName" TEXT,
    "emailSubject" TEXT NOT NULL DEFAULT 'Payment reminder: {amount} due {dueDate}',
    "emailTemplate" TEXT NOT NULL DEFAULT 'Hi {name},

This is a friendly reminder that {amount} is due on {dueDate}.

Thank you!',
    "lastRunDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "daysOfWeek" "Weekday"[] DEFAULT ARRAY['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']::"Weekday"[],
    "scheduleTimes" TEXT[] DEFAULT ARRAY['08:00']::TEXT[],
    "maxItems" INTEGER NOT NULL DEFAULT 30,
    "lastRunDate" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digest_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "DigestSourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "etag" TEXT,
    "lastModified" TEXT,
    "resolvedChannelId" TEXT,
    "seenKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastFetchedAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digest_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crosspost_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CrossPostSourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "mode" "CrossPostMode" NOT NULL DEFAULT 'APPROVAL',
    "targets" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "etag" TEXT,
    "lastModified" TEXT,
    "resolvedChannelId" TEXT,
    "uploadsPlaylistId" TEXT,
    "baselineAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crosspost_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crosspost_items" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "status" "CrossPostItemStatus" NOT NULL DEFAULT 'NEW',
    "drafts" JSONB,
    "approvedAt" TIMESTAMP(3),
    "approvalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crosspost_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_usage" (
    "id" TEXT NOT NULL,
    "scope" "QuotaScope" NOT NULL,
    "subject" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_channels_userId_idx" ON "notification_channels"("userId");

-- CreateIndex
CREATE INDEX "notification_channels_kind_externalRef_idx" ON "notification_channels"("kind", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "notification_channels_userId_kind_externalRef_key" ON "notification_channels"("userId", "kind", "externalRef");

-- CreateIndex
CREATE INDEX "notification_rules_userId_source_enabled_idx" ON "notification_rules"("userId", "source", "enabled");

-- CreateIndex
CREATE INDEX "notification_rule_targets_channelId_idx" ON "notification_rule_targets"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_idempotencyKey_key" ON "notification_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_events_fannedOutAt_createdAt_idx" ON "notification_events"("fannedOutAt", "createdAt");

-- CreateIndex
CREATE INDEX "notification_events_userId_createdAt_idx" ON "notification_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_events_createdAt_idx" ON "notification_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_idempotencyKey_key" ON "workflow_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "workflow_runs_status_nextRetryAt_idx" ON "workflow_runs"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "workflow_runs_userId_createdAt_idx" ON "workflow_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_runs_subjectType_subjectId_idx" ON "workflow_runs"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "workflow_runs_createdAt_idx" ON "workflow_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_idempotencyKey_key" ON "workflow_steps"("idempotencyKey");

-- CreateIndex
CREATE INDEX "workflow_steps_createdAt_idx" ON "workflow_steps"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_runId_key_key" ON "workflow_steps"("runId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_tokens_tokenHash_key" ON "telegram_link_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_userId_idx" ON "telegram_link_tokens"("userId");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_expiresAt_idx" ON "telegram_link_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_installationId_key" ON "github_installations"("installationId");

-- CreateIndex
CREATE INDEX "github_installations_userId_idx" ON "github_installations"("userId");

-- CreateIndex
CREATE INDEX "github_installations_accountId_idx" ON "github_installations"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "google_integrations_userId_key" ON "google_integrations"("userId");

-- CreateIndex
CREATE INDEX "google_integrations_status_idx" ON "google_integrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "linkedin_integrations_userId_key" ON "linkedin_integrations"("userId");

-- CreateIndex
CREATE INDEX "linkedin_integrations_status_tokenExpiresAt_idx" ON "linkedin_integrations"("status", "tokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credentials_userId_key" ON "ai_credentials"("userId");

-- CreateIndex
CREATE INDEX "uptime_monitors_enabled_nextCheckAt_idx" ON "uptime_monitors"("enabled", "nextCheckAt");

-- CreateIndex
CREATE INDEX "uptime_monitors_userId_idx" ON "uptime_monitors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "forms_publicId_key" ON "forms"("publicId");

-- CreateIndex
CREATE INDEX "forms_userId_idx" ON "forms"("userId");

-- CreateIndex
CREATE INDEX "form_submissions_formId_createdAt_idx" ON "form_submissions"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "form_submissions_createdAt_idx" ON "form_submissions"("createdAt");

-- CreateIndex
CREATE INDEX "receivables_status_nextReminderOn_idx" ON "receivables"("status", "nextReminderOn");

-- CreateIndex
CREATE INDEX "receivables_userId_status_idx" ON "receivables"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_settings_userId_key" ON "reminder_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "digest_settings_userId_key" ON "digest_settings"("userId");

-- CreateIndex
CREATE INDEX "digest_sources_userId_enabled_idx" ON "digest_sources"("userId", "enabled");

-- CreateIndex
CREATE INDEX "crosspost_sources_enabled_nextPollAt_idx" ON "crosspost_sources"("enabled", "nextPollAt");

-- CreateIndex
CREATE INDEX "crosspost_sources_userId_idx" ON "crosspost_sources"("userId");

-- CreateIndex
CREATE INDEX "crosspost_items_userId_createdAt_idx" ON "crosspost_items"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "crosspost_items_status_idx" ON "crosspost_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "crosspost_items_sourceId_externalId_key" ON "crosspost_items"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "quota_usage_day_idx" ON "quota_usage"("day");

-- CreateIndex
CREATE UNIQUE INDEX "quota_usage_scope_subject_day_key" ON "quota_usage"("scope", "subject", "day");

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule_targets" ADD CONSTRAINT "notification_rule_targets_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "notification_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule_targets" ADD CONSTRAINT "notification_rule_targets_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_integrations" ADD CONSTRAINT "google_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_integrations" ADD CONSTRAINT "linkedin_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uptime_monitors" ADD CONSTRAINT "uptime_monitors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_settings" ADD CONSTRAINT "digest_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_sources" ADD CONSTRAINT "digest_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crosspost_sources" ADD CONSTRAINT "crosspost_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crosspost_items" ADD CONSTRAINT "crosspost_items_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "crosspost_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crosspost_items" ADD CONSTRAINT "crosspost_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
