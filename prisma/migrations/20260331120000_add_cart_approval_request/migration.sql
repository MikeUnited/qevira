-- CreateTable
CREATE TABLE "CartApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestedBy" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CartApprovalRequest_organizationId_idx" ON "CartApprovalRequest"("organizationId");

-- CreateIndex
CREATE INDEX "CartApprovalRequest_requestedBy_idx" ON "CartApprovalRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "CartApprovalRequest_status_idx" ON "CartApprovalRequest"("status");
