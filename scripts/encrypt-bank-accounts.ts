// One-time migration script to encrypt existing
// plaintext bank account numbers
// Run once: npx tsx scripts/encrypt-bank-accounts.ts
// Safe to run multiple times (idempotent)
import "./load-project-env";

import { encryptCredential } from "@/lib/credential-encryption";
import { prisma } from "@/lib/prisma";

async function main() {
  if (!process.env.CREDENTIAL_ENCRYPTION_SECRET?.trim()) {
    console.error(
      "CREDENTIAL_ENCRYPTION_SECRET is not set. Add a 32-byte key (base64) to .env or .env.local — see .env.example."
    );
    process.exit(1);
  }

  const accounts = await prisma.bankAccount.findMany();

  let encryptedCount = 0;
  let skippedCount = 0;

  for (const account of accounts) {
    const raw = account.accountNumber;
    const looksEncrypted = raw.includes(":");

    if (looksEncrypted) {
      console.log("Already encrypted, skipping:", account.id);
      skippedCount += 1;
      continue;
    }

    const encrypted = encryptCredential(account.accountNumber);
    await prisma.bankAccount.update({
      where: { id: account.id },
      data: { accountNumber: encrypted },
    });
    console.log("Encrypted account:", account.id);
    encryptedCount += 1;
  }

  console.log(
    `Total processed: ${accounts.length} (${encryptedCount} encrypted, ${skippedCount} skipped)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
