import { createHash } from "node:crypto";

import { decryptCredential, encryptCredential } from "@/lib/credential-encryption";

/** Digits only, for stable hashing and dedup. */
export function normalizeBankAccountDigits(accountNumber: string): string {
  return accountNumber.replace(/\D/g, "");
}

export function hashBankAccountNumberForStorage(accountNumber: string): string {
  const digits = normalizeBankAccountDigits(accountNumber);
  return createHash("sha256").update(digits, "utf8").digest("hex");
}

export function encryptBankAccountNumberAtRest(plain: string): string {
  return encryptCredential(plain);
}

function looksLikeAesGcmCredentialBlob(s: string): boolean {
  const parts = s.split(":");
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

/** Decrypt ciphertext from DB, or return legacy plaintext rows. */
export function decryptBankAccountNumberStored(stored: string): string {
  if (!looksLikeAesGcmCredentialBlob(stored)) {
    return stored;
  }
  try {
    return decryptCredential(stored);
  } catch {
    return stored;
  }
}
