-- CreateTable
CREATE TABLE "GuardianRegistrationRequest" (
    "id" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "residentNameHint" TEXT,
    "residentNumberHint" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'pending',
    "residentId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianRegistrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianRegistrationRequest_tenantId_status_idx" ON "GuardianRegistrationRequest"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "GuardianRegistrationRequest" ADD CONSTRAINT "GuardianRegistrationRequest_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianRegistrationRequest" ADD CONSTRAINT "GuardianRegistrationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Carehome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianRegistrationRequest" ADD CONSTRAINT "GuardianRegistrationRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
