-- CreateEnum
CREATE TYPE "StoreOrderStatus" AS ENUM ('NEW', 'DECLINED', 'PENDING_DELIVERY', 'IN_PROGRESS', 'DELIVERED');

-- CreateEnum
CREATE TYPE "StoreOrderStatusActorKind" AS ENUM ('ADMIN', 'CLIENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "StoreProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stockQuantity" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrder" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "carehomeId" TEXT NOT NULL,
    "status" "StoreOrderStatus" NOT NULL DEFAULT 'NEW',
    "deliveryAddressLine" TEXT NOT NULL,
    "deliveryCity" TEXT NOT NULL,
    "deliveryPostcode" TEXT NOT NULL,
    "itemsSubtotal" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(6,4) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productImageUrl" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "StoreOrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "StoreOrderStatus",
    "toStatus" "StoreOrderStatus" NOT NULL,
    "actorKind" "StoreOrderStatusActorKind" NOT NULL,
    "adminUserId" TEXT,
    "clientUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreProduct_archivedAt_idx" ON "StoreProduct"("archivedAt");

-- CreateIndex
CREATE INDEX "StoreProduct_name_idx" ON "StoreProduct"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_referenceId_key" ON "StoreOrder"("referenceId");

-- CreateIndex
CREATE INDEX "StoreOrder_carehomeId_status_idx" ON "StoreOrder"("carehomeId", "status");

-- CreateIndex
CREATE INDEX "StoreOrder_status_requestedAt_idx" ON "StoreOrder"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "StoreOrder_referenceId_idx" ON "StoreOrder"("referenceId");

-- CreateIndex
CREATE INDEX "StoreOrderLineItem_orderId_idx" ON "StoreOrderLineItem"("orderId");

-- CreateIndex
CREATE INDEX "StoreOrderLineItem_productId_idx" ON "StoreOrderLineItem"("productId");

-- CreateIndex
CREATE INDEX "StoreOrderStatusHistory_orderId_createdAt_idx" ON "StoreOrderStatusHistory"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_carehomeId_fkey" FOREIGN KEY ("carehomeId") REFERENCES "Carehome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderLineItem" ADD CONSTRAINT "StoreOrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderLineItem" ADD CONSTRAINT "StoreOrderLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StoreProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderStatusHistory" ADD CONSTRAINT "StoreOrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderStatusHistory" ADD CONSTRAINT "StoreOrderStatusHistory_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
