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
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_BankAccount" ("accountName", "accountNumber", "bankName", "branchName", "id", "isPrimary", "profileId", "verificationStatus") SELECT "accountName", "accountNumber", "bankName", "branchName", "id", "isPrimary", "profileId", "verificationStatus" FROM "BankAccount";
DROP TABLE "BankAccount";
ALTER TABLE "new_BankAccount" RENAME TO "BankAccount";
CREATE UNIQUE INDEX "BankAccount_accountNumber_key" ON "BankAccount"("accountNumber");
CREATE INDEX "BankAccount_profileId_idx" ON "BankAccount"("profileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
