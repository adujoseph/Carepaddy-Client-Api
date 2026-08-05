-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_jti_key" ON "StaffInvite"("jti");

-- CreateIndex
CREATE INDEX "StaffInvite_tenantId_used_idx" ON "StaffInvite"("tenantId", "used");

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
