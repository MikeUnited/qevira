-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VerificationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_VerificationCode" ("attempts", "code", "createdAt", "email", "expiresAt", "id") SELECT "attempts", "code", "createdAt", "email", "expiresAt", "id" FROM "VerificationCode";
DROP TABLE "VerificationCode";
ALTER TABLE "new_VerificationCode" RENAME TO "VerificationCode";
CREATE UNIQUE INDEX "VerificationCode_email_key" ON "VerificationCode"("email");
CREATE INDEX "VerificationCode_email_idx" ON "VerificationCode"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
