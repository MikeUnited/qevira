-- CreateTable
CREATE TABLE "SupplierCredentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredentials_supplierId_key" ON "SupplierCredentials"("supplierId");
