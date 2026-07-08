# Qevira UX Audit - Claude

**Date:** 2026-06-26  
**Auditor:** Claude Sonnet 4.6 (automated static analysis)  
**Codebase:** `/Users/michaelalene/Documents/Projects/UnitedPharma/united-pharma`  
**Production:** https://qevira.michaelalene.com

---

## Part 1: User Types

### 1. Guest (Unauthenticated)

**Role/tier definition:**  
No session cookie (`bamys_session`). Determined in `middleware.ts` by the absence of a valid decrypted JWT.

**Routes accessible:**
- `/marketplace` — full catalog browse (read-only, no add-to-cart)
- `/marketplace/product/[slug]` — product detail
- `/login`, `/register` — entry points
- `/forgot-password`, `/reset-password`
- `/invite/accept` — invite token redemption page (public page, but requires a valid token)

**Blocked by middleware:**
- `/marketplace/cart` and `/marketplace/checkout` → redirected to `/login?callbackUrl=...`
- `/dashboard` and `/complete-kyc` → redirected to `/login`

**Actions available:**
- Browse catalog (`GET /api/marketplace/catalog`) — tier filtering is skipped when `getUserProfile()` returns no profile; guests see all items that have prices (all tiers visible as a teaser)
- No cart, no checkout, no orders

---

### 2. Manufacturer Supplier (Tier 0)

**Role/tier definition:**  
ERPNext `Supplier.supplier_group = "Manufacturer"`. Resolved via `getUserProfile()` → `lib/server-user-profile.ts`. Tier constant: `TIER_MAP.Manufacturer = 0`.

**Routes accessible (post-KYC):**
- `/dashboard` — selling mode only (no buying panel shown if no `customerGroup`)
- `/dashboard/sales` — catalog management (requires KYC step 6 via `requireKycStep6OrRedirect()`)
- `/dashboard/sales/stock` — stock entry
- `/dashboard/sales/inventory` — inventory view
- `/dashboard/sales/orders` — sales orders (incoming from downstream buyers)
- `/dashboard/settings` — account settings
- `/dashboard/settings/team` — team management

**Blocked actions:**
- Cannot buy from marketplace: `getAllowedSupplierGroups("Manufacturer", false)` returns `[]` in `lib/tiers.ts:31`. Cart POST returns 403 "You do not have access to purchase from this supplier tier."
- No procurement routes shown in nav (`showProcurement: false` for supplier-only users in `bamys-dashboard-shell.tsx`)

**Actions available via API:**
- `POST /api/vendor/catalog` — add item (requires `supplierGroup !== null`)
- `POST /api/vendor/inventory` — add stock (batch, price, stock entry)
- `GET /api/vendor/catalog/list` — list own catalog items
- `GET /api/dashboard/sales/orders` — view incoming sales orders
- `PUT /api/dashboard/sales/orders` — submit (docstatus 1) a draft sales order
- `GET/POST /api/notifications` — notifications
- `POST /api/team/invite` — invite team members (OWNER/DIRECTOR only)

---

### 3. Importer Supplier (Tier 1, may also buy)

**Role/tier definition:**  
ERPNext `Supplier.supplier_group = "Importer"`. May also have a Customer doc (dual-role). Tier: `TIER_MAP.Importer = 1`.

**Buying capability:**  
`ALLOWED_UPSTREAM.Importer = ["Manufacturer"]` — can buy from Manufacturer suppliers only. Enforced at catalog tier filter and cart POST tier guard.

**Routes accessible:**
- All supplier routes above
- If `customerGroup` is also set: procurement routes (`/dashboard/procurement/orders`, `/dashboard/inventory`) are visible
- Mode toggle (buying/selling) visible in dashboard shell when `isDualRole = true`

**Actions available (as buyer):**
- `GET /api/marketplace/catalog` — sees only Manufacturer items
- `POST /api/marketplace/cart` — add to cart (enforced at API level)
- `GET/PATCH/DELETE /api/marketplace/cart` — cart management
- `GET /api/marketplace/checkout/preview` — checkout preview
- `POST /api/marketplace/checkout/order` — place order (blocked for PHARMACIST role if team member)
- `GET /api/dashboard/procurement/orders` — order history
- `POST /api/dashboard/procurement/orders/confirm-receipt` — confirm receipt + stock entry to buyer warehouse
- `GET /api/dashboard/inventory/buyer` — buyer inventory view

---

### 4. Wholesaler Supplier (Tier 2, may also buy)

**Role/tier definition:**  
ERPNext `Supplier.supplier_group = "Wholesaler"`. Tier: `TIER_MAP.Wholesaler = 2`.

**Buying capability:**  
`ALLOWED_UPSTREAM.Wholesaler = ["Importer"]` — can buy from Importer suppliers only.

**Routes accessible:** Same pattern as Importer but buying panel shows Importer items only.

**Downstream selling:** Can list stock for Buyers/Hospitals (Tier 3) to purchase.

---

### 5. Buyer / Hospital (customer only, no supplier group)

**Role/tier definition:**  
Has ERPNext Customer doc (with `customer_group` set). No `supplierGroup` in `getUserProfile()`. `getAllowedSupplierGroups(null, true)` returns `"ALL"` in `lib/tiers.ts:18`.

**Routes accessible:**
- `/dashboard` — buying panel only
- `/dashboard/procurement` — procurement hub
- `/dashboard/procurement/orders` — order history
- `/dashboard/procurement/approvals` — if DIRECTOR/OWNER team role, see pending approvals
- `/dashboard/inventory` — buyer inventory (stock received from confirmed orders)
- `/dashboard/settings`, `/dashboard/settings/team`
- `/marketplace` — full catalog with all tiers visible

**Supplier routes blocked:** No `supplierGroup` → `GET /api/vendor/catalog/list` returns 403, `POST /api/vendor/catalog` returns 403, `GET /api/dashboard/sales/orders` returns 403.

**Actions available:**
- Browse all suppliers/tiers in marketplace
- Add to cart, checkout, confirm receipt
- Request cancellation of overdue orders
- View buyer inventory
- Invite team members (OWNER/DIRECTOR)
- Submit cart for approval (if PHARMACIST)

---

### 6. OWNER (TeamRole — buyer org team member)

**Role/tier definition:**  
Prisma `TeamMember.role = OWNER`. Claims embedded in session JWT: `teamRole`, `organizationId`, `organizationKind`. Created by the original account holder; OWNER cannot be invited (invite route blocks `role = OWNER`).

**Permissions:**
- Can invite DIRECTOR and PHARMACIST members (`POST /api/team/invite`)
- Can approve/reject pharmacist cart requests (`PUT /api/team/cart/approvals`)
- Can place orders directly (not blocked by `requireRole` guard which allows `allowMissingRole: true`)
- Can view pending approvals dashboard (`GET /api/team/cart/approvals` — blocks PHARMACIST only)

**Buying:** Resolved via `getBuyerContext` — looks up team member's `organizationId` as ERPNext Customer name.

---

### 7. DIRECTOR (TeamRole — buyer org team member)

**Role/tier definition:**  
Prisma `TeamMember.role = DIRECTOR`. Invited by OWNER only (code enforces: `teamRole === "DIRECTOR" && role === "DIRECTOR"` returns 403).

**Permissions (same as OWNER for approvals):**
- Can invite PHARMACIST members
- Cannot invite DIRECTOR (must be OWNER)
- Can approve/reject pharmacist cart requests
- Can place orders directly
- Can confirm receipt (`POST /api/dashboard/procurement/orders/confirm-receipt`)
- Cannot confirm receipt as PHARMACIST (role gate at line 64 in confirm-receipt route)

---

### 8. PHARMACIST (TeamRole — buyer org team member)

**Role/tier definition:**  
Prisma `TeamMember.role = PHARMACIST`. Invited by OWNER or DIRECTOR.

**Permissions:**
- Can add to cart, view cart, modify cart
- **Cannot place orders directly** — `POST /api/marketplace/checkout/order` returns 403 with message: "Pharmacists cannot place orders. Please ask a Director or Owner to confirm this purchase."
- Can submit cart for approval (`POST /api/team/cart/request-approval`) — only PHARMACIST role allowed
- **Cannot confirm receipt** — `POST /api/dashboard/procurement/orders/confirm-receipt` returns 403
- **Cannot view pending approvals** — `GET /api/team/cart/approvals` returns 403 for PHARMACIST
- Can view own procurement order history
- Cannot invite team members (only OWNER/DIRECTOR can invite)

---

## Part 2: Feature Inventory

### Guest Features

| Feature | Route / Endpoint | Status | TODO |
|---------|-----------------|--------|------|
| Browse catalog | `GET /api/marketplace/catalog` | Fully implemented | None |
| Product detail | `/marketplace/product/[slug]` | Fully implemented | None |
| Register | `/register` + `POST /api/register/init` etc. | Fully implemented | None |
| Login | `/login` + `POST /api/login` | Fully implemented | None |
| Forgot/reset password | `/forgot-password`, `/reset-password` | Fully implemented | None |

### Supplier Features (all supplier groups)

| Feature | Route / Endpoint | Status | TODO |
|---------|-----------------|--------|------|
| Add catalog item | `POST /api/vendor/catalog` | Fully implemented | `app/api/vendor/catalog/route.ts:219` — Replace global API key with per-tenant API key |
| View own catalog | `GET /api/vendor/catalog/list` | Fully implemented | None |
| Add stock entry | `POST /api/vendor/inventory` | Fully implemented | `app/api/vendor/inventory/route.ts:112` — Make idempotency key required; `app/api/vendor/inventory/route.ts:244` — Require per-tenant credentials |
| View inventory | `/dashboard/sales/inventory` (via `GET /api/vendor/catalog/list`) | Fully implemented | `inventory-client.tsx:232,838,847,856` — Min/Max stock and reorder point/days remaining fields show `—`; no ERPNext reorder data wired |
| View incoming sales orders | `GET /api/dashboard/sales/orders` | Fully implemented | `app/api/dashboard/sales/orders/route.ts:440` — Replace with per-tenant credentials |
| Confirm/submit a sales order | `PUT /api/dashboard/sales/orders` | Fully implemented | None |
| Invite team members | `POST /api/team/invite` | Fully implemented | None |
| View team members | `GET /api/team/members` | Fully implemented | None |

### Buyer Features

| Feature | Route / Endpoint | Status | TODO |
|---------|-----------------|--------|------|
| Browse marketplace with tier filter | `GET /api/marketplace/catalog` | Fully implemented | None |
| Add to cart | `POST /api/marketplace/cart` | Partial | `app/api/marketplace/cart/route.ts:1–6` — Cart deduplication uses `vendorAlias` (weekly rotating alias); items added across a week boundary may not deduplicate correctly |
| View/edit/delete cart | `GET/PATCH/DELETE /api/marketplace/cart` | Fully implemented | None |
| Checkout preview | `GET /api/marketplace/checkout/preview` | Fully implemented | None |
| Place order | `POST /api/marketplace/checkout/order` | Fully implemented | `lib/marketplace-checkout-execute.ts:519–522` — In-app notification created but supplier notification uses Resend email (email address looked up); in-app notification for supplier is missing (only buyer gets in-app) |
| View procurement orders | `GET /api/dashboard/procurement/orders` | Fully implemented | None |
| Confirm receipt (stock entry) | `POST /api/dashboard/procurement/orders/confirm-receipt` | Partial | `confirm-receipt/route.ts:14` — Partial receipt not implemented; all-or-nothing only; requires `docstatus = 1` (submitted by supplier) |
| Request cancellation (overdue) | `POST /api/dashboard/procurement/orders/cancel-request` | Partial | Only posts a Comment to ERPNext SO and emails admin; does not actually cancel the order in ERPNext — requires manual admin action |
| View buyer inventory | `GET /api/dashboard/inventory/buyer` | Fully implemented | None |
| Reduce buyer inventory (dispense) | `POST /api/dashboard/inventory/buyer/reduce` | Fully implemented | None |
| View receipts confirmed | `GET /api/dashboard/procurement/orders/receipts` | Fully implemented | None |

### Team (Pharmacist/Director/Owner) Features

| Feature | Route / Endpoint | Status | TODO |
|---------|-----------------|--------|------|
| Pharmacist: submit cart for approval | `POST /api/team/cart/request-approval` | Fully implemented | None |
| Director/Owner: view pending approvals | `GET /api/team/cart/approvals` | Fully implemented | None |
| Director/Owner: approve/reject cart | `PUT /api/team/cart/approvals` | Fully implemented | None |
| Owner: invite Director | `POST /api/team/invite` with `role=DIRECTOR` | Fully implemented | None |
| Owner/Director: invite Pharmacist | `POST /api/team/invite` with `role=PHARMACIST` | Fully implemented | None |
| Accept invite | `POST /api/team/accept` | Fully implemented | None |

### KYC/Registration Features

| Feature | Route / Endpoint | Status | TODO |
|---------|-----------------|--------|------|
| Init registration (OTP) | `POST /api/register/init` | Fully implemented | None |
| Personal details | `POST /api/register/personal-details` | Fully implemented | None |
| Organization KYC step | `POST /api/register/kyc/organization` | Fully implemented | None |
| Licenses KYC step | `POST /api/register/kyc/licenses` | Fully implemented | None |
| Tax KYC step | `POST /api/register/kyc/tax` | Fully implemented | None |
| Bank KYC step + warehouse automation | `POST /api/register/kyc/bank` | Partial | Warehouse failure is swallowed (try/catch, logged only); supplier will have no warehouse if ERPNext call fails, blocking all subsequent operations |
| Check credentials | `POST /api/register/check-credentials` | Fully implemented | None |
| Complete registration | `POST /api/register/complete` | Fully implemented | None |
| Resume KYC | `GET /api/register/resume` | Fully implemented | None |

---

## Part 3: User Flow Mapping

### Flow 1: Supplier Onboarding

**Register → KYC wizard → warehouse auto-created → add catalog item → add stock → item appears in marketplace**

| Step | File/Route | Status | Notes |
|------|-----------|--------|-------|
| 1. Register (OTP) | `/register` → `POST /api/register/init`, `POST /api/auth/otp/verify` | ✅ Works end-to-end | |
| 2. Personal details | `POST /api/register/personal-details` | ✅ Works end-to-end | |
| 3. Organization | `POST /api/register/kyc/organization` → `lib/register-kyc.ts:upsertKycBusinessEntities` | ✅ Works end-to-end | Creates/updates ERPNext Customer or Supplier |
| 4. Licenses (upload) | `POST /api/register/kyc/licenses` | ✅ Works end-to-end | Files uploaded to ERPNext via `lib/register-kyc.ts:uploadKycFiles` |
| 5. Tax | `POST /api/register/kyc/tax` | ✅ Works end-to-end | |
| 6. Bank KYC + session creation | `POST /api/register/kyc/bank` | ⚠️ Partially implemented | Warehouse automation in try/catch — if ERPNext warehouse creation fails, supplier has no `custom_warehouse`; session is still created and user lands at dashboard |
| 7. Warehouse auto-created | `lib/erpnext-warehouse.ts:ensureSupplierWarehouse` (called from bank route) | ⚠️ Partially implemented | Failure silently swallowed; no retry UI; user has no indication warehouse failed |
| 8. Add catalog item | `POST /api/vendor/catalog` | ✅ Works end-to-end | EFDA registration number required |
| 9. Add stock (batch + price + stock entry) | `POST /api/vendor/inventory` | ✅ Works end-to-end | Requires `custom_warehouse` on Supplier doc; if warehouse missing from step 7, returns 400 "Supplier warehouse not provisioned" |
| 10. Item appears in marketplace | `GET /api/marketplace/catalog` | ✅ Works end-to-end | Item visible once price + bin stock exist |

**Gap:** If step 7 (warehouse) fails silently during bank KYC, steps 9 and onward are permanently blocked. The user sees a generic "Please contact support" error when attempting to add stock. There is no UI pathway to re-trigger warehouse creation without admin intervention.

---

### Flow 2: Buyer Procurement (Direct)

**Register → KYC → browse marketplace → add to cart → checkout → order appears in supplier dashboard → supplier fulfills → buyer confirms receipt → stock appears in buyer inventory**

| Step | File/Route | Status | Notes |
|------|-----------|--------|-------|
| 1–6. Register + KYC | Same as Flow 1 | ✅ Works end-to-end | For buyer, `organizationType` must create Customer doc |
| 7. Browse marketplace | `/marketplace` → `GET /api/marketplace/catalog` | ✅ Works end-to-end | Tier filtering applied for authenticated users |
| 8. Add to cart | `POST /api/marketplace/cart` | ⚠️ Partially implemented | `vendorAlias` deduplication key rotates weekly; cross-week boundary deduplication broken (`cart/route.ts:1–6`) |
| 9. Checkout preview | `GET /api/marketplace/checkout/preview` | ✅ Works end-to-end | Shows stock warnings, batch expiry |
| 10. Place order | `POST /api/marketplace/checkout/order` | ✅ Works end-to-end | Creates Sales Order in ERPNext (docstatus 0 draft); sends buyer email + in-app notification |
| 11. Order appears in supplier dashboard | `GET /api/dashboard/sales/orders` | ✅ Works end-to-end | Supplier can see draft SO |
| 12. Supplier submits (fulfills) | `PUT /api/dashboard/sales/orders` (docstatus → 1) | ✅ Works end-to-end | Uses per-tenant credentials if provisioned, falls back to global |
| 13. Buyer confirms receipt | `POST /api/dashboard/procurement/orders/confirm-receipt` | ⚠️ Partially implemented | Requires `docstatus = 1` (supplier must submit first); no UI indicator that receipt is blocked until supplier acts; all-or-nothing (no partial receipt) |
| 14. Stock entry to buyer warehouse | Same route — creates ERPNext Material Receipt Stock Entry | ⚠️ Partially implemented | Requires buyer `custom_warehouse`; if warehouse missing (step 6 failure), returns 400 "No inventory warehouse configured" with no recovery path |
| 15. Stock appears in buyer inventory | `GET /api/dashboard/inventory/buyer` | ✅ Works end-to-end | Reads Bin from ERPNext buyer warehouse |

**Gap:** The procurement order list (`GET /api/dashboard/procurement/orders`) shows `docstatus` 0 as "Processing" and 1 as "Confirmed", but the Confirm Receipt button is not gated by docstatus — if the buyer clicks it while the order is still draft (docstatus 0), the API returns 400 "Order must be submitted before confirming receipt." The UI does not prevent this; the error is surfaced as a toast.

---

### Flow 3: Buyer Procurement (Team/Pharmacist)

**Pharmacist adds to cart → submits for approval → Director approves → order placed → supplier fulfills → Director confirms receipt → stock appears in buyer inventory**

| Step | File/Route | Status | Notes |
|------|-----------|--------|-------|
| 1. Pharmacist adds to cart | `POST /api/marketplace/cart` | ✅ Works end-to-end | Pharmacist can add to cart (no role block here) |
| 2. Pharmacist submits for approval | `POST /api/team/cart/request-approval` | ✅ Works end-to-end | Creates `CartApprovalRequest`; emails all Directors/Owners; creates in-app notifications for Directors |
| 3. Director sees pending approvals | `GET /api/team/cart/approvals` (approvals page) | ✅ Works end-to-end | Shows pending requests with cart line items |
| 4. Director approves → order placed | `PUT /api/team/cart/approvals` (action: APPROVE) | ✅ Works end-to-end | Calls `executeMarketplaceCheckoutOrder` for pharmacist's cart; emails pharmacist; creates notification |
| 5. Supplier submits sales order | `PUT /api/dashboard/sales/orders` | ✅ Works end-to-end | |
| 6. Director confirms receipt | `POST /api/dashboard/procurement/orders/confirm-receipt` | ✅ Works end-to-end | PHARMACIST role blocked; DIRECTOR allowed |
| 7. Stock in buyer inventory | `GET /api/dashboard/inventory/buyer` | ✅ Works end-to-end | |

**Gap:** There is no mechanism for a pharmacist to see the status of their submitted approval request in real time. The approvals page is blocked for PHARMACISTs — they can only see their order history after the Director approves. There is also no way to cancel or recall a pending approval request.

---

### Flow 4: Dual-Role User (Importer/Wholesaler)

**Buy from upstream supplier → confirm receipt → stock appears in own warehouse → list that stock for sale → downstream buyer orders it**

| Step | File/Route | Status | Notes |
|------|-----------|--------|-------|
| 1. Buy from upstream (e.g. Importer buys from Manufacturer) | `POST /api/marketplace/cart` + `POST /api/marketplace/checkout/order` | ✅ Works end-to-end | Tier gate enforced at cart POST |
| 2. Supplier submits SO | `PUT /api/dashboard/sales/orders` | ✅ Works end-to-end | |
| 3. Confirm receipt | `POST /api/dashboard/procurement/orders/confirm-receipt` | ⚠️ Partially implemented | Creates Material Receipt Stock Entry to buyer warehouse. The buyer warehouse and supplier warehouse are separate ERPNext warehouses. The stock lands in `custom_warehouse` on the Customer doc — NOT in `custom_warehouse` on the Supplier doc. |
| 4. Stock appears in buyer inventory | `GET /api/dashboard/inventory/buyer` | ✅ Works end-to-end | Reads buyer warehouse Bin |
| 5. List that stock for sale (as supplier) | `POST /api/vendor/inventory` | ❌ Missing | The dual-role user's supplier warehouse and buyer warehouse are separate. Stock received as a buyer (step 3) goes to `Customer.custom_warehouse`. To list stock for sale, supplier must re-enter it via `POST /api/vendor/inventory` (new stock entry). There is no transfer from buyer warehouse to supplier warehouse in the UI or API. |
| 6. Item visible in downstream marketplace | `GET /api/marketplace/catalog` | ✅ Works end-to-end | Once price + bin stock in supplier warehouse |

**Critical gap:** A dual-role Importer who buys from a Manufacturer and wants to resell cannot automatically "list" what they received. They must manually re-declare the stock using `POST /api/vendor/inventory`, specifying the same item code and quantity. This requires the user to understand the separation between buyer and supplier warehouses — not surfaced anywhere in the UI. The flow doubles the stock entries in ERPNext.

---

### Flow 5: Stock Management (Supplier)

**Supplier adds stock entry → stock appears in inventory → order placed reduces stock → reorder detection**

| Step | File/Route | Status | Notes |
|------|-----------|--------|-------|
| 1. Add stock entry | `POST /api/vendor/inventory` | ✅ Works end-to-end | Creates Batch, Item Price, Stock Entry (Material Receipt) in ERPNext; full rollback on failure |
| 2. Stock appears in supplier inventory | `GET /api/vendor/catalog/list` (inventory view uses this) | ✅ Works end-to-end | Reads Bin `actual_qty` |
| 3. Buyer places order → ERPNext SO created (draft) | `POST /api/marketplace/checkout/order` | ✅ Works end-to-end | SO is draft (docstatus 0), stock not yet committed in ERPNext |
| 4. Supplier submits SO (docstatus → 1) | `PUT /api/dashboard/sales/orders` | ✅ Works end-to-end | ERPNext will create delivery note and reduce stock on fulfillment (ERPNext-side) |
| 5. Stock reduction visible in inventory | `GET /api/vendor/catalog/list` after SO submitted | ⚠️ Partially implemented | Depends on ERPNext automatic stock reduction on SO submission/delivery note. Qevira does not explicitly trigger a stock reduction; it submits the SO and relies on ERPNext downstream logic. Whether `actual_qty` in Bin reflects correctly depends on ERPNext stock settings. |
| 6. Reorder detection | `inventory-client.tsx` stock level display | ❌ Missing | Min/Max fields (`reorder_level`, `reorder_qty` from ERPNext Item DocType) not fetched. Inventory UI shows `—` for Min/Max/Reorder Point/Days Remaining. `// TODO: Fetch reorder_level and reorder_qty from ERPNext Item DocType before beta` (inventory-client.tsx:838,847) |

---

## Part 4: Friction Points

### FP-1: Warehouse failure is invisible to the user

**File:** `app/api/register/kyc/bank/route.ts:196–202` (supplier warehouse) and `:204–224` (buyer warehouse)

Both warehouse automation blocks are inside `try/catch` that only `console.error` on failure. The bank KYC API returns `{ ok: true, sessionCreated: true }` regardless of whether the warehouse was created. The user is redirected to `/dashboard` with no indication that their warehouse does not exist. The first time they try to add stock or confirm receipt, they receive a generic "Supplier warehouse not provisioned. Please contact support." or "No inventory warehouse configured." error.

**What is needed:** Surface warehouse status in the KYC completion response, add a dashboard banner when `custom_warehouse` is null (similar to the existing `KycStatusBanner`), and provide a retry/contact support link.

---

### FP-2: Confirm receipt blocked when supplier has not yet submitted the order

**File:** `app/api/dashboard/procurement/orders/confirm-receipt/route.ts:162–167`

The API checks `docstatus !== 1` and returns 400. The buyer's procurement orders list shows `docstatus 0` as "Processing" and `docstatus 1` as "Confirmed", but the Confirm Receipt button appears to be available regardless of status. The user attempts to confirm, hits the error, and has no UI path to prompt the supplier to submit.

**What is needed:** Gate the Confirm Receipt button on `docstatus === 1` in the client (`procurement-orders-client.tsx`), or display "Awaiting supplier confirmation" with no button until the supplier acts.

---

### FP-3: Cancellation request does not actually cancel

**File:** `app/api/dashboard/procurement/orders/cancel-request/route.ts:100–156`

The endpoint posts an ERPNext Comment and sends an admin email. It does not change the Sales Order status in ERPNext. The user sees "Cancellation request submitted" but the order remains in its current state. There is no feedback in the order list that cancellation has been requested (the status label does not change).

**What is needed:** Either automatically cancel the SO in ERPNext (if policy allows), or update the order comment/status in a way that the buyer's order list reflects "Cancellation Requested" state. Currently the status label in `procurement-orders-client.tsx` is derived purely from `docstatus` (0=Processing, 1=Confirmed), ignoring the ERPNext `status` field (which may include "Cancellation Requested").

---

### FP-4: Dual-role stock transfer gap

**See Flow 4, Step 5.** A dual-role importer/wholesaler who receives goods (buyer warehouse) has no automated path to make that stock available for resale (supplier warehouse). They must manually re-declare stock in the supplier Add Stock flow, causing double-entry and potential confusion.

---

### FP-5: Cart deduplication breaks across week boundaries

**File:** `app/api/marketplace/cart/route.ts:1–6` (full TODO block)

Cart items are deduplicated using `vendorAlias` as the identity key. Because `vendorAlias` is an HMAC over `supplierId:ISO-year-week`, an item added on Sunday will not merge with the same item added on Monday — a second row is created. At checkout, both rows become separate order lines for the same item from the same supplier, potentially creating duplicate Sales Order lines.

**What is needed:** Use `supplierId + itemCode` (or `itemCode` alone) as the dedup key, not `vendorAlias`.

---

### FP-6: Pharmacist cannot see approval request status

There is no API endpoint or UI for a PHARMACIST to check whether their pending approval was approved, rejected, or is still pending — except by observing that the order appears in procurement history (which only happens post-approval). The `GET /api/team/cart/approvals` endpoint returns 403 for PHARMACISTs. The in-app notification system does send a notification on approval/rejection, but there is no explicit "My approval request status" view.

---

### FP-7: Supplier receives email for new order but no in-app notification

**File:** `lib/marketplace-checkout-execute.ts:519–528`

The code has a `TODO` comment: "Resolve supplier email from supplierId for supplier notification. For now only notify the buyer." The actual code does create an in-app notification — but addressed to `buyerNotificationEmail`, not the supplier. The supplier does receive a Resend email (lines 588–621), but no in-app `Notification` row is created for them. Suppliers who rely on the in-app notification bell will miss new orders.

---

### FP-8: Inventory Min/Max/Reorder fields are unpopulated

**File:** `app/dashboard/sales/inventory/inventory-client.tsx:838,847,856`

The Stock Levels view in the supplier inventory displays "—" for Min/Max, Reorder Point, and Days Remaining. The stock bar graphic uses a hardcoded proxy maximum of 200 (`stockBarPercent` at line 233). ERPNext Item DocType has `reorder_level` and `reorder_qty` fields. These are not fetched. Suppliers cannot make informed restocking decisions.

---

### FP-9: All-or-nothing receipt confirmation

**File:** `app/api/dashboard/procurement/orders/confirm-receipt/route.ts:14`

`// TODO: Implement partial receipt before beta — Currently all-or-nothing receipt confirmation`

If a buyer receives only part of their order (common in pharmaceutical supply), they have no way to confirm partial receipt. The entire order must be accepted or nothing. This forces either artificial compliance (confirming full receipt for partial delivery) or no confirmation at all.

---

### FP-10: Per-tenant API keys not yet provisioned for all suppliers

**Files:**
- `app/api/vendor/catalog/route.ts:219` — global API key used for item creation
- `app/api/vendor/inventory/route.ts:244` — per-tenant credentials optional
- `app/api/dashboard/sales/orders/route.ts:440` — per-tenant credentials optional

The `SupplierCredentials` Prisma model exists and `getSupplierCredentials` is called, but the fallback to global credentials means EFDA audit tracing (which requires per-supplier API attribution) is not enforced. All supplier write operations currently share the same global ERPNext API key.

---

### FP-11: KYC step consolidation causes duplicate ERPNext fetches

**File:** `app/dashboard/layout.tsx:35`

`// TODO: consolidate KYC status into a single server context to avoid duplicate fetches`

The dashboard layout calls `getResumeSuggestedStep()` which makes an HTTP request to `/api/register/resume` (or checks Prisma for team members). Each page under `/dashboard` that uses `requireKycStep6OrRedirect()` repeats this. React `cache()` deduplicates within a single render, but the implementation is fragile.

---

## Part 5: Priority Matrix

| Flow / Feature | Status | Effort to fix | Priority |
|---|---|---|---|
| FP-2: Confirm receipt blocked silently (no UI gate on docstatus) | Partial | Low — add client-side gate in `procurement-orders-client.tsx` | P1 |
| FP-1: Warehouse failure invisible after bank KYC | Partial | Medium — add dashboard banner + retry flow | P1 |
| FP-3: Cancel request has no effect on order status | Partial | Medium — either call ERPNext cancel API or reflect comment in UI status label | P1 |
| FP-5: Cart dedup breaks across week boundary | Partial | Medium — change dedup key from `vendorAlias` to `itemCode + supplierId` in Prisma CartItem | P1 |
| FP-9: All-or-nothing receipt confirmation | Partial | High — requires UI for partial quantities + multiple stock entries | P1 |
| FP-4: Dual-role stock transfer gap (received stock not listable without re-entry) | Missing | High — requires UI for buyer-to-supplier warehouse transfer or auto-transfer logic | P1 |
| FP-7: Supplier gets no in-app notification for new orders | Partial | Low — add `createNotification(supplierEmail, ...)` call in `marketplace-checkout-execute.ts` | P2 |
| FP-6: Pharmacist cannot see approval request status | Missing | Low–Medium — add `GET /api/team/cart/approvals/me` endpoint returning pharmacist's own requests | P2 |
| FP-8: Inventory Min/Max/Reorder fields unpopulated | Missing | Medium — fetch `reorder_level`/`reorder_qty` from ERPNext Item in `GET /api/vendor/catalog/list` | P2 |
| FP-10: Per-tenant API keys not provisioned for all suppliers | Partial | High — KYC provisioning pipeline needed; blocking EFDA audit compliance | P2 |
| Flow 4 (dual-role) complete path | Partial | High — warehouse transfer UX + API | P2 |
| Flow 5 step 6 (reorder detection) | Missing | Medium — fetch Item reorder fields + alert logic | P2 |
| FP-11: Duplicate KYC fetches in dashboard layout | Partial | Low — refactor using React cache or server context | P3 |
| Per-tenant credential enforcement (audit trailing) | Partial | High — requires all-supplier KYC provisioning | P3 |
| Pharmacist recall pending approval | Missing | Low — add DELETE/cancel endpoint for CartApprovalRequest | P3 |
| Flow 2 step 13 UI gate (receipt button state) | Partial | Low — add `docstatus` check in `procurement-orders-client.tsx` | P1 |

---

## Appendix: Full TODO Inventory

| File | Line | TODO Text |
|------|------|-----------|
| `app/api/marketplace/cart/route.ts` | 1–6 | Cart deduplication uses `vendorAlias` as identity key; fix before beta: use `supplierId + itemCode` |
| `app/api/vendor/catalog/route.ts` | 219 | Replace global API key with per-tenant API key for strict EFDA audit trailing |
| `app/api/vendor/inventory/route.ts` | 112 | Make idempotency key required once all clients send it |
| `app/api/vendor/inventory/route.ts` | 244 | Require per-tenant credentials once all suppliers are provisioned |
| `app/api/dashboard/sales/orders/route.ts` | 440 | Replace with per-tenant credentials once all suppliers are provisioned |
| `app/api/dashboard/procurement/orders/confirm-receipt/route.ts` | 14 | Implement partial receipt before beta |
| `lib/marketplace-checkout-execute.ts` | 519–522 | Resolve supplier email from supplierId for supplier notification |
| `app/dashboard/layout.tsx` | 35 | Consolidate KYC status into single server context |
| `app/dashboard/sales/inventory/inventory-client.tsx` | 232 | Replace proxy max (200) with actual `reorder_qty` from ERPNext |
| `app/dashboard/sales/inventory/inventory-client.tsx` | 838,847 | Fetch `reorder_level` and `reorder_qty` from ERPNext Item DocType before beta |
| `app/dashboard/sales/inventory/inventory-client.tsx` | 856 | Calculate days remaining from sales velocity once order analytics built |
| `components/importer-shell.tsx` | 3 | Legacy component — review before removal |

---

*Generated by automated static analysis of source files. No source files were modified.*
