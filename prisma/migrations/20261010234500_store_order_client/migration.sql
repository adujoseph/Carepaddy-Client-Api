ALTER TABLE "StoreOrder" ADD COLUMN "residentId" TEXT NOT NULL;
ALTER TABLE "StoreOrder" ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "StoreOrder_residentId_status_idx" ON "StoreOrder"("residentId", "status");

ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
