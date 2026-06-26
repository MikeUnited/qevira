-- AlterTable
-- SQLite: add column with default so existing TeamMember rows get CUSTOMER.
ALTER TABLE "TeamMember" ADD COLUMN "organizationKind" TEXT NOT NULL DEFAULT 'CUSTOMER';
