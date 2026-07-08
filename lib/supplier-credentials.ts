import { decryptCredential, encryptCredential } from "@/lib/credential-encryption";
import { prisma } from "@/lib/prisma";

/** AES-GCM blob from encryptCredential, or legacy plaintext from before encryption. */
function decryptCredentialOrLegacy(stored: string): string | null {
  const parts = stored.split(":");
  const looksEnc =
    parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
  if (!looksEnc) {
    return stored;
  }
  try {
    return decryptCredential(stored);
  } catch {
    return null;
  }
}

/**
 * Returns plaintext API credentials for ERPNext calls. Decryption runs only on the server
 * (API routes / server actions); never import this from client components.
 */
export async function getSupplierCredentials(
  supplierId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const row = await prisma.supplierCredentials.findUnique({
    where: { supplierId },
  });
  if (!row) return null;
  const apiKey = decryptCredentialOrLegacy(row.apiKey);
  const apiSecret = decryptCredentialOrLegacy(row.apiSecret);
  if (apiKey === null || apiSecret === null) return null;
  return { apiKey, apiSecret };
}

export async function saveSupplierCredentials(
  supplierId: string,
  apiKey: string,
  apiSecret: string
): Promise<void> {
  const encKey = encryptCredential(apiKey);
  const encSecret = encryptCredential(apiSecret);
  await prisma.supplierCredentials.upsert({
    where: { supplierId },
    create: { supplierId, apiKey: encKey, apiSecret: encSecret },
    update: { apiKey: encKey, apiSecret: encSecret },
  });
}
