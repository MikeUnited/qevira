import { erpnextFetch, type ErpnextEnv } from "@/lib/erpnext-auth";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import type { KycBankAccountPayload } from "@/lib/validation/kyc-bank";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

/** Resolve or create `Bank` master; returns the Bank document `name` (link target). */
export async function getOrCreateBankMaster(
  env: ErpnextEnv,
  bankDisplayName: string
): Promise<string> {
  const filters = JSON.stringify([["bank_name", "=", bankDisplayName]]);
  const listQs = new URLSearchParams({
    filters,
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const listRes = await erpnextFetch(
    env,
    `/api/resource/Bank?${listQs}`,
    { cache: "no-store" }
  );
  const listJson = await listRes.json().catch(() => ({}));
  if (listRes.ok) {
    const rows = extractDataRows(listJson);
    const n = rows[0]?.name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }

  const postRes = await erpnextFetch(env, `/api/resource/Bank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bank_name: bankDisplayName }),
    cache: "no-store",
  });
  const postJson = await postRes.json().catch(() => ({}));
  if (!postRes.ok) {
    const msg =
      tryExtractFrappeMessage(postJson) ?? `Bank master: HTTP ${postRes.status}`;
    throw new Error(msg);
  }
  const data =
    postJson &&
    typeof postJson === "object" &&
    "data" in postJson &&
    postJson.data &&
    typeof postJson.data === "object" &&
    postJson.data !== null &&
    !Array.isArray(postJson.data)
      ? (postJson as { data: Record<string, unknown> }).data
      : null;
  const name = data && typeof data.name === "string" ? data.name.trim() : "";
  if (name) return name;

  const retry = await erpnextFetch(
    env,
    `/api/resource/Bank?${listQs}`,
    { cache: "no-store" }
  );
  const retryJson = await retry.json().catch(() => ({}));
  if (retry.ok) {
    const rows = extractDataRows(retryJson);
    const n = rows[0]?.name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  throw new Error("Could not resolve Bank master after create.");
}

async function postPartyBankAccount(
  env: ErpnextEnv,
  partyType: "Supplier" | "Customer",
  partyName: string,
  bankDocName: string,
  row: KycBankAccountPayload
): Promise<void> {
  const body: Record<string, unknown> = {
    account_name: row.accountName,
    party_type: partyType,
    party: partyName,
    bank: bankDocName,
    bank_account_no: row.accountNumber,
    branch_code: row.branchName,
    is_default: row.isPrimary ? 1 : 0,
    is_company_account: 0,
  };

  const res = await erpnextFetch(env, `/api/resource/Bank Account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      tryExtractFrappeMessage(json) ?? `Bank Account: HTTP ${res.status}`;
    throw new Error(msg);
  }
}

/**
 * Creates Bank Account rows for each party, non-primary first so ERPNext default logic applies.
 */
export async function syncPartyBankAccountsToErpnext(
  env: ErpnextEnv,
  parties: { type: "Supplier" | "Customer"; name: string }[],
  accounts: KycBankAccountPayload[]
): Promise<void> {
  if (parties.length === 0 || accounts.length === 0) return;

  const sorted = [...accounts].sort(
    (a, b) => (a.isPrimary ? 1 : 0) - (b.isPrimary ? 1 : 0)
  );

  const bankLinks = new Map<string, string>();
  for (const acc of sorted) {
    if (!bankLinks.has(acc.bankName)) {
      bankLinks.set(
        acc.bankName,
        await getOrCreateBankMaster(env, acc.bankName)
      );
    }
  }

  for (const { type, name } of parties) {
    for (const row of sorted) {
      const bankDoc = bankLinks.get(row.bankName);
      if (!bankDoc) {
        throw new Error(`Missing bank link for ${row.bankName}`);
      }
      await postPartyBankAccount(env, type, name, bankDoc, row);
    }
  }
}
