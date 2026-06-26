-- CreateTable
CREATE TABLE "ProcurementReceiptConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BuyerWarehouse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ProcurementReceiptConfirmation_userId_idx" ON "ProcurementReceiptConfirmation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementReceiptConfirmation_userId_orderId_key" ON "ProcurementReceiptConfirmation"("userId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerWarehouse_customerId_key" ON "BuyerWarehouse"("customerId");
