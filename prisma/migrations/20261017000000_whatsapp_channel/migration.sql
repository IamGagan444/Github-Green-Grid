-- AlterEnum
ALTER TYPE "ChannelKind" ADD VALUE 'WHATSAPP';

-- AlterEnum
ALTER TYPE "QuotaScope" ADD VALUE 'WHATSAPP_MESSAGES';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'WHATSAPP_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'WHATSAPP_DISCONNECTED';

-- CreateTable
CREATE TABLE "whatsapp_link_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_link_tokens_tokenHash_key" ON "whatsapp_link_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "whatsapp_link_tokens_userId_idx" ON "whatsapp_link_tokens"("userId");

-- CreateIndex
CREATE INDEX "whatsapp_link_tokens_expiresAt_idx" ON "whatsapp_link_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "whatsapp_link_tokens" ADD CONSTRAINT "whatsapp_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
