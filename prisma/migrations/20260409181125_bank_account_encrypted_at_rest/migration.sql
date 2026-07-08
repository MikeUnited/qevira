/*
  Warnings:

  - Added the required column `accountNumberHash` to the `BankAccount` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BankAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountNumberHash" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Placeholder hash per row (unique per id) so existing rows migrate; run
-- `npx tsx scripts/backfill-bank-account-encryption.ts` after migrate to set
-- real SHA-256 hashes and encrypt account numbers at rest.
INSERT INTO "new_BankAccount" ("accountName", "accountNumber", "bankName", "branchName", "createdAt", "id", "isPrimary", "profileId", "verificationStatus", "accountNumberHash")
SELECT "accountName", "accountNumber", "bankName", "branchName", "createdAt", "id", "isPrimary", "profileId", "verificationStatus", lower(hex(randomblob(32))) FROM "BankAccount";
DROP TABLE "BankAccount";
ALTER TABLE "new_BankAccount" RENAME TO "BankAccount";
CREATE INDEX "BankAccount_profileId_idx" ON "BankAccount"("profileId");
CREATE UNIQUE INDEX "BankAccount_profileId_accountNumberHash_key" ON "BankAccount"("profileId", "accountNumberHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
