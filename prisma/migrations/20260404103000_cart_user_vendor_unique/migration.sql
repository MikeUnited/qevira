-- CreateIndex
CREATE UNIQUE INDEX "CartItem_userId_vendorAlias_key" ON "CartItem"("userId", "vendorAlias");
