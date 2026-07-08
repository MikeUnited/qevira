/**
 * Standalone ERPNext permission diagnostics for Sales Order / Sales Order Item.
 *
 * Usage (from repo root):
 *   npx tsx scripts/debug-erpnext-permissions.ts
 *
 * Optional env (in .env.local):
 *   DEBUG_ORDER_NAME=SAL-ORD-2026-00002
 *   DEBUG_SO_ITEM_NAME=...   (Test 3: child row `name` from Sales Order items; often a hash, not ORDER-1)
 */

import { config } from "dotenv";
import { resolve } from "node:path";

import {
  erpnextFetch,
  readErpnextEnv,
  type ErpnextEnv,
} from "../lib/erpnext-auth";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const ORDER_NAME =
  process.env.DEBUG_ORDER_NAME?.trim() || "SAL-ORD-2026-00002";
const ITEM_DOC_NAME =
  process.env.DEBUG_SO_ITEM_NAME?.trim() || `${ORDER_NAME}-1`;

type TestResult = {
  name: string;
  status: number;
  ok: boolean;
  body: string;
};

async function runTest(
  name: string,
  pathOrUrl: string,
  env: ErpnextEnv
): Promise<TestResult> {
  const res = await erpnextFetch(env, pathOrUrl, { cache: "no-store" });
  const body = await res.text();
  return {
    name,
    status: res.status,
    ok: res.ok,
    body,
  };
}

function printTest(r: TestResult): void {
  console.log("\n" + "=".repeat(72));
  console.log(`Test: ${r.name}`);
  console.log("-".repeat(72));
  console.log(`HTTP status: ${r.status}`);
  console.log(`Result: ${r.ok ? "SUCCEEDED" : "FAILED"}`);
  console.log("Response body:");
  console.log(r.body);
}

async function run(): Promise<void> {
  const env = readErpnextEnv();
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }

  console.log("ERPNext permission diagnostics");
  console.log(`ERPNEXT_URL: ${env.baseUrl}`);
  console.log(`X-Frappe-Site-Name: ${env.siteName}`);
  console.log(`ORDER_NAME: ${ORDER_NAME}`);
  console.log(`ITEM_DOC_NAME (Test 3): ${ITEM_DOC_NAME}`);

  const results: TestResult[] = [];

  // Test 1: read Sales Order header
  const path1 = `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(ORDER_NAME)}`;
  results.push(await runTest("Test 1: GET Sales Order header", path1, env));

  // Test 2: list Sales Order Item by parent (same pattern as app)
  const qs2 = new URLSearchParams({
    filters: JSON.stringify([["parent", "=", ORDER_NAME]]),
    fields: JSON.stringify(["name", "warehouse", "qty"]),
    limit_page_length: "500",
  });
  const path2 = `/api/resource/${encodeURIComponent("Sales Order Item")}?${qs2}`;
  results.push(
    await runTest(
      "Test 2: GET Sales Order Item list (resource API, parent filter)",
      path2,
      env
    )
  );

  // Test 3: fetch one Sales Order Item by name
  const path3 = `/api/resource/${encodeURIComponent("Sales Order Item")}/${encodeURIComponent(ITEM_DOC_NAME)}`;
  results.push(
    await runTest(
      "Test 3: GET Sales Order Item by document name",
      path3,
      env
    )
  );

  // Test 4: frappe.client.get_list (RPC-style GET)
  const qs4 = new URLSearchParams({
    doctype: "Sales Order Item",
    filters: JSON.stringify([["parent", "=", ORDER_NAME]]),
    fields: JSON.stringify(["name", "warehouse", "qty"]),
    limit_page_length: "500",
  });
  const path4 = `/api/method/frappe.client.get_list?${qs4}`;
  results.push(
    await runTest(
      "Test 4: GET frappe.client.get_list (Sales Order Item)",
      path4,
      env
    )
  );

  // Test 5: Sales Order with items child table in fields
  const qs5 = new URLSearchParams({
    fields: JSON.stringify(["name", "items"]),
  });
  const path5 = `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(ORDER_NAME)}?${qs5}`;
  results.push(
    await runTest(
      "Test 5: GET Sales Order with items child table fields",
      path5,
      env
    )
  );

  for (const r of results) {
    printTest(r);
  }

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${r.name} — HTTP ${r.status}`);
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("-".repeat(72));
  console.log(`Passed: ${passed} / ${results.length}`);
  console.log(`Failed: ${failed} / ${results.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
