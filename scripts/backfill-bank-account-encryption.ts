/**
 * After migrating to encrypted BankAccount columns, run once:
 *   npx tsx scripts/backfill-bank-account-encryption.ts
 *
 * Idempotent: rows already using AES-GCM blob format with matching hash are skipped.
 */
import "./load-project-env";

import {
  decryptBankAccountNumberStored,
  encryptBankAccountNumberAtRest,
  hashBankAccountNumberForStorage,
  normalizeBankAccountDigits,
} from "../lib/bank-account-storage";
import { prisma } from "../lib/prisma";

async function main() {
  const rows = await prisma.bankAccount.findMany();
  let updated = 0;
  for (const r of rows) {
    const plain = decryptBankAccountNumberStored(r.accountNumber);
    if (!normalizeBankAccountDigits(plain)) {
      console.warn(
        `backfill-bank-account-encryption: skipping row ${r.id} (no digits in account number)`
      );
      continue;
    }
    const expectedHash = hashBankAccountNumberForStorage(plain);
    const enc = encryptBankAccountNumberAtRest(plain);
    if (r.accountNumber === enc && r.accountNumberHash === expectedHash) {
      continue;
    }
    await prisma.bankAccount.update({
      where: { id: r.id },
      data: {
        accountNumber: enc,
        accountNumberHash: expectedHash,
      },
    });
    updated += 1;
  }
  console.log(`backfill-bank-account-encryption: updated ${updated} row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
