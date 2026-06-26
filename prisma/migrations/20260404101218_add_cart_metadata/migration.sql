/*
  Warnings:

  - Added the required column `genericName` to the `CartItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `CartItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `uom` to the `CartItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vendorAlias` to the `CartItem` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CartItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "offerToken" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "vendorAlias" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "uom" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CartItem" ("createdAt", "id", "offerToken", "quantity", "userId") SELECT "createdAt", "id", "offerToken", "quantity", "userId" FROM "CartItem";
DROP TABLE "CartItem";
ALTER TABLE "new_CartItem" RENAME TO "CartItem";
CREATE INDEX "CartItem_userId_idx" ON "CartItem"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
