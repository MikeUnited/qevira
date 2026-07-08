-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN "orderId" TEXT;
ALTER TABLE "CartItem" ADD COLUMN "orderStatus" TEXT;

-- CreateIndex
CREATE INDEX "CartItem_orderId_idx" ON "CartItem"("orderId");
