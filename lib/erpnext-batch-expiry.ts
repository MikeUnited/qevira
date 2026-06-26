import { erpnextFetch, type ErpnextEnv } from "@/lib/erpnext-auth";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function normalizeExpiryDate(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return null;
}

/** Earliest batch expiry for an Item (Item.name), or null if none. */
export async function fetchEarliestBatchExpiry(
  env: ErpnextEnv,
  itemName: string
): Promise<string | null> {
  const info = await fetchEarliestBatchInfo(env, itemName);
  return info.expiry;
}

/** Earliest batch row for an Item: expiry + batch reference (not item code). */
export async function fetchEarliestBatchInfo(
  env: ErpnextEnv,
  itemName: string
): Promise<{ expiry: string | null; batchLabel: string | null }> {
  const qs = new URLSearchParams({
    filters: JSON.stringify([["item", "=", itemName]]),
    fields: JSON.stringify(["expiry_date", "name", "batch_id"]),
    order_by: "expiry_date asc",
    limit_page_length: "1",
  });
  const res = await erpnextFetch(env, `/api/resource/Batch?${qs}`, {
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { expiry: null, batchLabel: null };
  const rows = extractDataRows(json);
  const row = rows[0];
  if (!row) return { expiry: null, batchLabel: null };
  const batchId = row.batch_id;
  const name = row.name;
  const batchLabel =
    typeof batchId === "string" && batchId.trim()
      ? batchId.trim()
      : typeof name === "string" && name.trim()
        ? name.trim()
        : null;
  return {
    expiry: normalizeExpiryDate(row.expiry_date),
    batchLabel,
  };
}
