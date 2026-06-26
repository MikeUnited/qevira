import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_SECRET;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET is not set");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_SECRET must decode to 32 bytes (AES-256 key)"
    );
  }
  return buf;
}

export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return (
    iv.toString("hex") +
    ":" +
    authTag.toString("hex") +
    ":" +
    encrypted.toString("hex")
  );
}

export function decryptCredential(encryptedData: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Decryption integrity check failed");
  }
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(encHex, "hex");
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    throw new Error("Decryption integrity check failed");
  }
}
