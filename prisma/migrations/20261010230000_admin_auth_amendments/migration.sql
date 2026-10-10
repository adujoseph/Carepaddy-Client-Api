-- Admin auth amendments: MFA, session idle tracking
ALTER TABLE "AdminUser" ADD COLUMN "mfaTotpSecretEnc" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3);
ALTER TABLE "AdminUser" ADD COLUMN "mfaRecoveryRegenRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AdminSession" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AdminMfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminMfaRecoveryCode_adminUserId_idx" ON "AdminMfaRecoveryCode"("adminUserId");

ALTER TABLE "AdminMfaRecoveryCode" ADD CONSTRAINT "AdminMfaRecoveryCode_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
