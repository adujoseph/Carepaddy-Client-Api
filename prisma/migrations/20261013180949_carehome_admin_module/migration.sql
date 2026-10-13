-- AlterTable
ALTER TABLE "Carehome" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT,
ADD COLUMN     "deactivationNote" TEXT,
ADD COLUMN     "deactivationReason" TEXT,
ADD COLUMN     "inviteSendFailedAt" TIMESTAMP(3),
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "manuallyInactive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manuallyInactiveAt" TIMESTAMP(3),
ADD COLUMN     "manuallyInactiveById" TEXT,
ADD COLUMN     "manuallyInactiveReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "addressLine" DROP NOT NULL,
ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "postcode" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Carehome_status_createdAt_idx" ON "Carehome"("status", "createdAt");

-- Backfill: existing self-registered homes count as activated at creation; last activity is the
-- latest of creation, a care user session, or an order.
UPDATE "Carehome" c
SET "activatedAt" = c."createdAt",
    "lastActivityAt" = GREATEST(
      c."createdAt",
      (SELECT MAX(s."createdAt") FROM "Session" s JOIN "User" u ON u."id" = s."userId" WHERE u."tenantId" = c."id"),
      (SELECT MAX(o."requestedAt") FROM "StoreOrder" o WHERE o."carehomeId" = c."id")
    )
WHERE c."status" <> 'pending';

-- CQC number is immutable once a care home exists.
CREATE OR REPLACE FUNCTION carehome_cqc_number_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."cqcNumber" IS DISTINCT FROM OLD."cqcNumber" THEN
    RAISE EXCEPTION 'CQC_IMMUTABLE: Carehome.cqcNumber cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER carehome_cqc_number_immutable
BEFORE UPDATE OF "cqcNumber" ON "Carehome"
FOR EACH ROW EXECUTE FUNCTION carehome_cqc_number_immutable();
