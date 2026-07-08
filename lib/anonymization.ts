import { createHmac } from "crypto";

function getCurrentWeekKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  // ISO week number calculation
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const dayOfYear =
    Math.floor((now.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const weekNumber = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(weekNumber).padStart(2, "0")}`;
}

// Alias rotates weekly: stable within Mon 00:00
// to Sun 23:59 UTC, then resets.
// This allows buyers to build within-cycle trust
// while breaking long-term correlation attacks.
// Input: supplierId (ERPNext Supplier doc name)
//        + SUPPLIER_ALIAS_SALT env var
//        + ISO year-week (e.g. "2026-W15")
export function generateSupplierAlias(supplierId: string): string {
  const salt = process.env.SUPPLIER_ALIAS_SALT;
  if (!salt) {
    throw new Error(
      "SUPPLIER_ALIAS_SALT environment variable is required"
    );
  }

  const weekKey = getCurrentWeekKey();
  const input = `${supplierId}:${weekKey}`;

  const hmac = createHmac("sha256", salt);
  hmac.update(input);
  const hex = hmac.digest("hex");

  // Take first 8 hex chars, convert to number,
  // mod 10000 for 4-digit alias
  const num = parseInt(hex.slice(0, 8), 16) % 10000;
  const digits = String(num).padStart(4, "0");

  return `Vendor #${digits}`;
}
