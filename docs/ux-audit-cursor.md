# Qevira UX Audit (Cursor)

**Date:** 2026-06-26  
**Scope:** Read-only audit of all user types, features, flows, gaps, and friction points.  
**Method:** Full codebase read — `lib/tiers.ts`, `lib/server-user-profile.ts`, `prisma/schema.prisma`, `middleware.ts`, all routes under `app/` and `app/api/`.  
**Production:** https://qevira.michaelalene.com

---

## Part 1: User Types

Sources: `lib/tiers.ts`, `lib/server-user-profile.ts`, `prisma/schema.prisma` (`TeamRole`, `OrganizationKind`), `middleware.ts`, `components/bamys-dashboard-shell.tsx`.

### 1. Guest (unauthenticated)

| Attribute | Detail |
|-----------|--------|
| **Definition** | No `bamys_session` cookie |
| **Tier / role** | None |

**Can see (routes):**
- `/` → redirects to `/marketplace`
- `/marketplace`, `/marketplace/product/[slug]` — catalog and product detail
- `/login`, `/register`, `/forgot-password`, `/reset-password`
- `/invite/accept` (accept flow requires completing signup)

**Can do:**
- Browse catalog with client-side search/filters (category, expiry, vendor alias, stock status)
- View product names, stock indicators, expiry, supplier count
- Navigate to login/register

**Cannot do:**
- `/marketplace/cart`, `/marketplace/checkout` — middleware redirects to `/login?callbackUrl=…`
- `/dashboard/*` — middleware redirects to `/login`
- See per-offer prices in UI (guest teaser); add to cart

**Notes:** `GET /api/marketplace/catalog` returns full JSON including prices and `offerToken`s without auth — privacy/teaser model is UI-only.

---

### 2. Manufacturer (Tier 0 supplier)

| Attribute | Detail |
|-----------|--------|
| **Definition** | ERPNext `Supplier.supplier_group = "Manufacturer"`; no Customer record |
| **Tier** | `TIER_MAP["Manufacturer"] = 0` |
| **Upstream buying** | `getAllowedSupplierGroups()` → `[]` — cannot buy upstream |

**Can see:**
- `/dashboard` — supplier overview (`SupplierDashboard` in selling mode)
- `/dashboard/sales`, `/dashboard/sales/inventory`, `/dashboard/sales/stock`, `/dashboard/sales/orders` (KYC step ≥ 6)
- `/dashboard/settings`, `/dashboard/settings/team`
- `/marketplace` — own listings only (tier filter hides all upstream offers)

**Can do:**
- Self-service catalog item creation (`POST /api/vendor/catalog` via `/dashboard/sales`)
- Add stock + pricing (`POST /api/vendor/inventory` via `/dashboard/sales/stock`)
- View supplier inventory and client-side reorder heuristics
- Submit draft Sales Orders (`PUT /api/dashboard/sales/orders`)
- Invite/revoke team members (OWNER at registration)
- Receive checkout notification emails (when supplier email on file in ERPNext)

**Cannot do:**
- Add to cart / checkout (no Customer record → `getBuyerContext` fails)
- `/dashboard/procurement/*`, `/dashboard/inventory` (buyer features)
- Meaningful buying-mode toggle

---

### 3. Importer (Tier 1 supplier, dual-role capable)

| Attribute | Detail |
|-----------|--------|
| **Definition** | `Supplier.supplier_group = "Importer"`; may also have `Customer` with `customer_group = "Importer"` |
| **Tier** | `TIER_MAP["Importer"] = 1` |
| **Upstream buying** | `ALLOWED_UPSTREAM["Importer"] = ["Manufacturer"]` |
| **Dual-role** | Registration `organizationType: importer` creates **both** Customer and Supplier (`lib/register-kyc.ts` `kind: "both"`) |

**Can see:**
- All Manufacturer supplier actions (selling nav)
- When dual-role: buying nav (marketplace, procurement, buyer inventory) + mode toggle
- Marketplace filtered to Manufacturer offers (+ own listings)

**Can do:**
- Everything Manufacturer can do on sell side
- If dual-role: browse upstream, cart, checkout, procurement orders, buyer inventory
- Toggle Buying/Selling (`mode-context.tsx`, persisted in `localStorage`)

**Cannot do:**
- Buy from other Importers or Wholesalers (tier rules)
- Buy at all if registered without Customer record (legacy/manual data issue only — registration path creates both)

---

### 4. Wholesaler (Tier 2 supplier, dual-role capable)

| Attribute | Detail |
|-----------|--------|
| **Definition** | `Supplier.supplier_group = "Wholesaler"`; optional `Customer` with `customer_group = "Wholesaler"` |
| **Tier** | `TIER_MAP["Wholesaler"] = 2` |
| **Upstream buying** | `ALLOWED_UPSTREAM["Wholesaler"] = ["Importer"]` |
| **Dual-role** | Registration `organizationType: wholesaler` creates both Customer and Supplier |

Same pattern as Importer, one tier down: buys from Importers only, sells to downstream buyers.

---

### 5. Buyer / Hospital / Pharmacy (customer only)

| Attribute | Detail |
|-----------|--------|
| **Definition** | ERPNext Customer only (`pharmacy` or `hospital` registration); no Supplier record |
| **Tier** | Tier 3 — `getAllowedSupplierGroups(null, true)` → `"ALL"` |

**Can see:**
- Full marketplace (all supplier tiers)
- `/dashboard` — buyer overview panel
- `/marketplace`, `/dashboard/procurement/orders`, `/dashboard/inventory`
- `/dashboard/procurement/approvals` if OWNER or DIRECTOR
- `/dashboard/settings/team`

**Can do:**
- Cart, checkout (OWNER/DIRECTOR or legacy users without `teamRole`)
- View procurement order history, request cancellation on overdue orders
- View buyer warehouse inventory, record usage (`POST …/inventory/buyer/reduce`)
- Invite DIRECTOR/PHARMACIST, manage team

**Cannot do:**
- `/dashboard/sales/*` (no supplier record)
- Confirm receipt via UI (**API exists, no UI** — see Flow 2)
- PHARMACIST: direct checkout (blocked; must request approval)

---

### 6. OWNER (team member of buyer org)

| Attribute | Detail |
|-----------|--------|
| **Definition** | `TeamRole.OWNER`, `organizationKind: CUSTOMER`; founding registrant (not a `TeamMember` row — resolved at login via `resolveOwnerOrganization`) |
| **Session claims** | `teamRole`, `organizationId`, `organizationKind` on JWT |

**Permissions vs pure buyer:**
- Full procurement + inventory
- Place orders without approval
- Approve pharmacist cart requests
- Invite DIRECTOR and PHARMACIST; revoke any member except self
- Confirm receipt (API — OWNER allowed; no UI)

---

### 7. DIRECTOR (team member of buyer org)

| Attribute | Detail |
|-----------|--------|
| **Definition** | `TeamMember.role = DIRECTOR`, `organizationKind = CUSTOMER`, invited by OWNER |

**Permissions:**
- Place orders directly
- Approve/reject pharmacist carts (`/dashboard/procurement/approvals`, `PUT /api/team/cart/approvals`)
- Invite PHARMACIST only; revoke PHARMACIST only
- Confirm receipt (API)
- Nav badge for pending approvals

**Cannot do:**
- Invite or revoke DIRECTOR

---

### 8. PHARMACIST (team member of buyer org)

| Attribute | Detail |
|-----------|--------|
| **Definition** | `TeamMember.role = PHARMACIST`, invited by OWNER or DIRECTOR |
| **KYC** | `GET /api/register/resume` returns `suggestedStep: 6` — inherits org KYC |

**Can do:**
- Browse marketplace, add to cart
- Submit cart for director approval (`POST /api/team/cart/request-approval`)
- View procurement orders and buyer inventory
- Record inventory usage (`reduce`)

**Cannot do:**
- Place orders (`requireRole` blocks at checkout API)
- Access `/dashboard/procurement/approvals`
- Confirm receipt (API returns 403)
- Invite/revoke team members

**Gap:** No in-app “my pending approval” status view; rejection = email only (no in-app notification). Approval = email + `ORDER_UPDATE` notification.

---

### Route access summary (middleware + layout)

| Route pattern | Guest | Authenticated |
|---------------|-------|---------------|
| `/marketplace` | ✅ | ✅ |
| `/marketplace/cart`, `/checkout` | ❌ → login | ✅ (buyer context required at API) |
| `/dashboard/*` | ❌ → login | ✅ (layout re-checks session) |
| `/login`, `/register` | ✅ | ❌ → `/dashboard` |
| `/complete-kyc` | ❌ → login | ✅ |

API routes are **not** covered by `middleware.ts`; each handler enforces auth independently.

---

## Part 2: Feature Inventory

Grouped by primary user type. Status: **Complete** | **Partial** | **Missing**.

### Guest

| Feature | Route / API | Status | TODOs / notes |
|---------|-------------|--------|---------------|
| Catalog browse | `GET /api/marketplace/catalog` | Complete | Tier filter skipped for guests |
| Product detail | `/marketplace/product/[slug]` | Partial | Fulfillment rate placeholder |
| Search & filters | `/marketplace` (client) | Complete | |
| Login / register | `/login`, `/register` | Complete | |
| OTP | `/api/auth/otp/*` | Complete | |
| Password reset | `/api/auth/forgot-password`, `reset-password` | Complete | |

### Manufacturer / Importer / Wholesaler (supplier)

| Feature | Route / API | Status | TODOs / notes |
|---------|-------------|--------|---------------|
| Supplier dashboard | `/dashboard` (selling mode) | Partial | Revenue MTD, growth, top products stubbed |
| Create catalog item | `/dashboard/sales` → `POST /api/vendor/catalog` | Complete | Global API key; no edit/delete |
| List own catalog | `GET /api/vendor/catalog/list` | Partial | No batch/expiry in list; `batchExpiry` UI unused |
| Add stock entry | `/dashboard/sales/stock` → `POST /api/vendor/inventory` | Partial | Idempotency key optional; per-tenant creds optional |
| Supplier inventory | `/dashboard/sales/inventory` | Partial | Reorder thresholds hardcoded; no ERP min/max |
| Sales orders | `/dashboard/sales/orders` → `GET/PUT /api/dashboard/sales/orders` | Partial | Fulfill = submit SO only; global API key fallback |
| Team settings | `/dashboard/settings/team` | Complete | Supplier org team (if used) |
| KYC wizard | `/register`, `/complete-kyc`, `/api/register/kyc/*` | Complete | Warehouse on bank step (best-effort) |
| Notifications | `/api/notifications/*` | Complete | Bell in shell |

**Supplier TODOs in code:**
- `app/api/vendor/catalog/route.ts` — per-tenant API key for EFDA audit
- `app/api/vendor/inventory/route.ts` — require idempotency key; per-tenant credentials
- `app/api/dashboard/sales/orders/route.ts` — per-tenant credentials
- `app/dashboard/sales/inventory/inventory-client.tsx` — ERP reorder_level/qty; sales velocity
- `components/dashboard/supplier-dashboard.tsx` — real MTD analytics

### Buyer / team (customer)

| Feature | Route / API | Status | TODOs / notes |
|---------|-------------|--------|---------------|
| Marketplace browse | `/marketplace` | Complete | Tier filter when supplier profile |
| Add/update/remove cart | `/api/marketplace/cart` | Complete | Dedupe by `vendorAlias` breaks on alias rotation |
| Cart page | `/marketplace/cart` | Partial | VAT not calculated |
| Checkout preview | `GET /api/marketplace/checkout/preview` | Partial | No tier re-check; delivery_date not returned |
| Place order | `POST /api/marketplace/checkout/order` | Partial | Bank transfer only; no stock/expiry re-validation at execute |
| Request cart approval | `POST /api/team/cart/request-approval` | Complete | No cart snapshot on request |
| Approvals queue | `/dashboard/procurement/approvals` | Complete | DIRECTOR/OWNER only |
| Approve/reject cart | `PUT /api/team/cart/approvals` | Complete | Approve runs checkout on pharmacist cart |
| Procurement orders | `/dashboard/procurement/orders` | Partial | Line items missing for director-viewed approval orders; status label mismatch |
| Confirm receipt | `POST /api/dashboard/procurement/orders/confirm-receipt` | **Partial** | **No UI**; all-or-nothing only |
| Receipt state | `GET /api/dashboard/procurement/orders/receipts` | Complete | **Not consumed by any UI** |
| Cancel overdue order | `POST /api/dashboard/procurement/orders/cancel-request` | Complete | ERPNext Comment + admin email |
| Buyer inventory | `/dashboard/inventory` → `GET /api/dashboard/inventory/buyer` | Complete | Empty until receipt confirmed |
| Stock reduction | `POST /api/dashboard/inventory/buyer/reduce` | Complete | Material Issue in buyer WH |
| Team invite/accept | `/api/team/invite`, `/invite/accept` | Complete | |
| Team members | `/dashboard/settings/team` | Complete | |

**Buyer TODOs:**
- `app/api/dashboard/procurement/orders/confirm-receipt/route.ts` — partial receipt
- `app/marketplace/checkout/page.tsx`, `cart/page.tsx` — Ethiopian VAT
- `lib/marketplace-checkout-execute.ts` — stale supplier email TODO (email fetch exists later)

### Shared / auth / system

| Feature | Route / API | Status | Notes |
|---------|-------------|--------|-------|
| Session profile | `GET /api/user/profile`, `/api/auth/me` | Complete | |
| Login | `POST /api/login` | Complete | Rate limited (Redis) |
| Logout | `POST /api/logout` | Complete | |
| Registration init | `POST /api/register/init` | Complete | Creates ERPNext User |
| Resume KYC | `GET /api/register/resume` | Complete | |
| Check credentials | `POST /api/register/check-credentials` | Complete | **Unused in UI** |
| Legacy one-shot KYC | `POST /api/register/complete` | Complete | Not used by wizard |
| ERPNext health | `GET /api/erpnext-health` | Complete | |
| Admin supplier credentials | `POST /api/admin/supplier-credentials` | Partial | Manual admin only |
| Importer legacy route | `/importer` | Complete | Redirects to `/dashboard` |
| Legacy browse | `/dashboard/browse` | Complete | Redirects to `/marketplace` |
| Procurement hub | `/dashboard/procurement` | Complete | Redirects to `/marketplace` |
| Success fallback | `/success` | Partial | Dead-end “under review” copy |

### All API endpoints (index)

| Endpoint | Methods | Primary consumers |
|----------|---------|-------------------|
| `/api/auth/me` | GET | Marketplace auth state |
| `/api/auth/otp/request`, `verify` | POST | Registration |
| `/api/auth/forgot-password`, `reset-password` | POST | Password recovery |
| `/api/login`, `/api/logout` | POST | Auth |
| `/api/register/init`, `personal-details`, `resume`, `complete`, `check-credentials` | POST/PATCH/GET | Registration |
| `/api/register/kyc/organization`, `licenses`, `tax`, `bank` | POST | KYC |
| `/api/marketplace/catalog` | GET | Catalog |
| `/api/marketplace/cart` | GET, POST, PATCH, DELETE | Cart |
| `/api/marketplace/checkout/preview` | GET | Checkout |
| `/api/marketplace/checkout/order` | POST | Order placement |
| `/api/dashboard/procurement/orders` | GET | Order history |
| `/api/dashboard/procurement/orders/confirm-receipt` | POST | Receipt → buyer WH |
| `/api/dashboard/procurement/orders/receipts` | GET | Confirmed order IDs |
| `/api/dashboard/procurement/orders/cancel-request` | POST | Cancellation request |
| `/api/dashboard/inventory/buyer` | GET | Buyer inventory |
| `/api/dashboard/inventory/buyer/reduce` | POST | Usage / issue |
| `/api/dashboard/sales/orders` | GET, PUT | Supplier orders |
| `/api/vendor/catalog` | POST | Item create |
| `/api/vendor/catalog/list` | GET | Supplier catalog + stock |
| `/api/vendor/inventory` | POST | Stock receipt |
| `/api/team/invite`, `accept`, `members` | POST, GET, DELETE | Team |
| `/api/team/cart/request-approval`, `approvals` | POST, GET, PUT | Cart approval |
| `/api/notifications`, `/api/notifications/[id]` | GET, PATCH | Notifications |
| `/api/user/profile` | GET | Profile |
| `/api/admin/supplier-credentials` | POST | Admin |
| `/api/erpnext-health` | GET | Ops |

---

## Part 3: User Flow Mapping

### Flow 1: Supplier onboarding

*Register → KYC → warehouse → catalog item → stock → marketplace*

| Step | Route / component | Status | Notes |
|------|-------------------|--------|-------|
| 1. Register + OTP | `/register` → `/api/register/init` | ✅ E2E | Creates ERPNext `User`, session |
| 2. Personal details | `/api/register/personal-details` | ✅ E2E | Updates `User` |
| 3. Organization | `/api/register/kyc/organization` | ✅ E2E | Creates `Supplier` (and `Customer` for importer/wholesaler) |
| 4. Licenses | `/api/register/kyc/licenses` | ✅ E2E | EFDA + business license on party + file uploads |
| 5. Tax / TIN | `/api/register/kyc/tax` | ✅ E2E | `kycComplete` gate at step ≥ 6 |
| 6. Bank + warehouses | `/api/register/kyc/bank` | ⚠️ Partial | `ensureSupplierWarehouse` / `ensureBuyerWarehouse`; failures logged, not surfaced |
| 7. Redirect dashboard | `/dashboard` | ✅ E2E | |
| 8. Add catalog item | `/dashboard/sales` → `POST /api/vendor/catalog` | ✅ E2E | Self-service; **not in sidebar** — reach via inventory CTA or supplier dashboard |
| 9. Add stock + price | `/dashboard/sales/stock` → `POST /api/vendor/inventory` | ✅ E2E | Batch + Item Price + Material Receipt |
| 10. Appears in marketplace | `GET /api/marketplace/catalog` | ✅ E2E | Requires Bin qty + Standard Buying price |

**Gaps:**
- Catalog/Stock routes hidden from sidebar (`bamys-dashboard-shell` only lists Inventory + Orders under Catalog)
- Warehouse creation failure = silent; supplier may be unable to receive stock
- Item edit/delete not available in-app
- Per-tenant ERPNext credentials require manual admin (`/api/admin/supplier-credentials`)

**ERPNext admin intervention (should be automated):**
- Supplier API credentials provisioning
- Recovery if warehouse creation failed at KYC

---

### Flow 2: Buyer procurement (direct)

*Register → KYC → browse → cart → checkout → supplier fulfills → confirm receipt → buyer inventory*

| Step | Route / component | Status | Notes |
|------|-------------------|--------|-------|
| 1. Register + KYC | `/register`, `/complete-kyc` | ✅ E2E | Buyer warehouse on bank step |
| 2. Browse marketplace | `/marketplace` | ✅ E2E | |
| 3. Add to cart | `POST /api/marketplace/cart` | ✅ E2E | Requires `getBuyerContext` |
| 4. Review cart | `/marketplace/cart` | ⚠️ Partial | No VAT |
| 5. Checkout | `/marketplace/checkout` → `POST …/checkout/order` | ⚠️ Partial | Bank transfer only; preview may block but execute does not re-validate stock |
| 6. ERPNext Sales Order | `lib/marketplace-checkout-execute.ts` | ✅ E2E | Draft `docstatus: 0`, one SO per supplier |
| 7. Order in supplier dashboard | `/dashboard/sales/orders` | ✅ E2E | |
| 8. Supplier submits SO | `PUT /api/dashboard/sales/orders` | ✅ E2E | `docstatus → 1`; not Delivery Note / stock issue |
| 9. Buyer confirms receipt | `POST …/confirm-receipt` | ❌ **Missing UI** | API creates Material Receipt into buyer WH |
| 10. Stock in buyer inventory | `GET /api/dashboard/inventory/buyer` | ⚠️ Partial | Works only after step 9 invoked |

**Gaps:**
- **Critical:** No confirm-receipt button in procurement orders UI
- Partial receipt not implemented (TODO in API)
- Payment methods “Card” / “Net 30” shown as coming soon
- Checkout `delivery_date` mismatch (UI +7 days vs SO uses today)
- Supplier stock not reserved/deducted on order; buyer receipt is standalone Material Receipt

**ERPNext admin intervention:**
- None for happy path if KYC warehouses succeeded
- Batch read permission for confirm-receipt (`Batch` DocType)

---

### Flow 3: Buyer procurement (team / pharmacist)

*Pharmacist carts → approval → director places order → fulfill → confirm receipt → inventory*

| Step | Route / component | Status | Notes |
|------|-------------------|--------|-------|
| 1. Pharmacist browse + cart | `/marketplace`, cart APIs | ✅ E2E | |
| 2. Checkout blocked | Checkout UI + API | ✅ E2E | Shows “Request Director Approval” |
| 3. Request approval | `POST /api/team/cart/request-approval` | ✅ E2E | One PENDING per org |
| 4. Director notified | Email + `APPROVAL_REQUEST` notification | ✅ E2E | |
| 5. Director reviews | `/dashboard/procurement/approvals` | ✅ E2E | |
| 6. Approve → order placed | `PUT /api/team/cart/approvals` → `executeMarketplaceCheckoutOrder` | ✅ E2E | Uses pharmacist’s cart |
| 7. Pharmacist notified (approve) | Email + `ORDER_UPDATE` notification | ✅ E2E | |
| 8. Pharmacist notified (reject) | Email only | ⚠️ Partial | No in-app notification |
| 9. Supplier submits SO | Same as Flow 2 step 8 | ✅ E2E | |
| 10. Director confirms receipt | API only | ❌ **Missing UI** | Pharmacist cannot confirm (by design) |
| 11. Buyer inventory | `/dashboard/inventory` | ⚠️ Partial | Shared org warehouse; needs step 10 |

**Gaps:**
- No pharmacist “approval status” page
- Director order history may show empty line items for orders placed via approval (cart rows under pharmacist `userId`)
- Cart not snapshotted at approval request — director approves live cart state
- Rejection has no in-app notification

---

### Flow 4: Dual-role (Importer / Wholesaler)

*Buy upstream → confirm receipt → own warehouse → list for sale → downstream order*

| Step | Route / component | Status | Notes |
|------|-------------------|--------|-------|
| 1. Register as importer/wholesaler | `/api/register/kyc/organization` | ✅ E2E | Creates **both** Customer + Supplier |
| 2. Dual-role detected | `getUserProfile()` → `isDualRole` | ✅ E2E | |
| 3. Buying mode + tier filter | `/marketplace`, `canViewSupplier` | ✅ E2E | Importer→Manufacturer; Wholesaler→Importer |
| 4. Procure upstream | Flow 2 | ⚠️ Partial | Blocked at confirm-receipt UI |
| 5. Stock in supplier warehouse | Receipt + own WH from KYC | ⚠️ Partial | Upstream stock lands in **buyer** WH; must list via stock entry on **supplier** WH |
| 6. Switch to selling mode | Mode toggle | ✅ E2E | |
| 7. Add stock / price for resale | `/dashboard/sales/stock` | ✅ E2E | Manual step — procurement does not auto-transfer to supplier WH |
| 8. Downstream buyer orders | Flow 2 for buyers | ✅ E2E | |

**Gaps:**
- No automated stock transfer from buyer WH to supplier WH after upstream receipt
- Dual-role user must manually re-enter stock on sell side (or ERPNext admin Stock Entry transfer)
- Manufacturer cannot participate as buyer (by tier design)

**ERPNext admin intervention:**
- Stock transfer between buyer and supplier warehouses if not done via app stock page

---

### Flow 5: Stock management

*Supplier stock entry → marketplace → order → reduction → reorder*

| Step | Route / component | Status | Notes |
|------|-------------------|--------|-------|
| 1. Supplier adds stock | `POST /api/vendor/inventory` | ✅ E2E | Material Receipt submitted |
| 2. Marketplace shows stock | Catalog Bin query | ⚠️ Partial | Sums qty across warehouses, not per-supplier WH |
| 3. Buyer orders | Sales Order created | ✅ E2E | No reservation |
| 4. Supplier submits SO | `PUT` sales orders | ✅ E2E | No stock deduction in app |
| 5. Buyer receipt | confirm-receipt API | ⚠️ Partial | Increases buyer WH; no UI |
| 6. Reorder detection | `inventory-client.tsx` | ⚠️ Partial | Hardcoded thresholds (<50, <10, proxy max 200) |
| 7. Sales velocity / ERP reorder | — | ❌ Missing | TODOs in inventory client |

**Gaps:**
- Marketplace stock may not match supplier-warehouse reality
- No supplier-side stock deduction on fulfillment
- Reorder alerts are cosmetic without ERP `reorder_level` / `reorder_qty`

---

## Part 4: Friction Points

### Dead ends (no clear next action)

| Location | Problem |
|----------|---------|
| `/success` | “Account under review” with only link to marketplace — used when session creation fails; no status polling |
| Supplier post-KYC | Sidebar omits Catalog + Stock; new supplier may not discover `/dashboard/sales` |
| Procurement orders after supplier submit | No “Confirm receipt” action — flow stops |
| PHARMACIST after approval request | No pending-status view; must check email/notifications or ask director |
| `/dashboard/procurement` | Redirects to marketplace, not order history |
| Manufacturer on marketplace | Empty upstream catalog with no explanation of tier rules |

### Errors without recovery path

| Location | Problem |
|----------|---------|
| KYC bank step warehouse failure | Logged only; user proceeds to dashboard; stock/receipt features fail later |
| ERPNext env missing on dashboard | Layout renders shell with null profile; no dedicated error/retry page |
| `getBuyerContext` failure at cart | 403 with message; supplier-as-only-role cannot buy — no in-app “enable buying” path |
| Checkout idempotency 409 | “Duplicate request” — user may not know if order was placed |
| Team approve when pharmacist buyer missing | 400 error; no guided fix |

### UI ahead of API (or API ahead of UI)

| Surface | Issue |
|---------|-------|
| Cart / checkout tax | UI defers to invoice; no VAT API |
| Payment method selector | Card / Net 30 disabled placeholders |
| Product fulfillment rate | Placeholder on product page |
| Confirm receipt | **API complete, UI absent** |
| Receipts GET | Implemented, never called from frontend |
| Reorder min/max / days remaining | UI shows `—`; client uses fake thresholds |
| Supplier dashboard analytics | KPIs stubbed or use stock as proxy for sales |

### Manual admin intervention (should be automated)

| Scenario | Current state |
|----------|---------------|
| Per-supplier ERPNext API keys | Admin POST to `/api/admin/supplier-credentials` |
| Warehouse creation failure | No alert; manual ERPNext warehouse + link |
| Dual-role stock transfer (buy WH → sell WH) | Manual stock entry or ERPNext admin |
| Item catalog for suppliers who skip `/dashboard/sales` | No admin UI in app — ERPNext directly |
| Turso migrations on production | `prisma migrate deploy` (ops, not in-app) |

---

## Part 5: Priority Matrix

| Flow / Issue | Status | Effort to fix | Priority |
|--------------|--------|---------------|----------|
| Confirm receipt UI (Flows 2, 3, 4) | API complete, **no UI** | Low–Medium — button on procurement orders + receipts state | **P0** |
| Buyer inventory never populates in normal use | Blocked by missing receipt UI | Low (same as above) | **P0** |
| Supplier catalog/stock discoverability (sidebar) | Partial — routes exist but hidden | Low — add nav links | **P1** |
| PHARMACIST rejection in-app notification | Partial — email only | Low | **P1** |
| PHARMACIST approval status view | Missing | Low–Medium | **P1** |
| Checkout execute: re-validate stock/expiry/tier | Partial | Medium | **P1** |
| Order line items for director-viewed approval orders | Partial — empty `items[]` | Medium — query by `orderId` not cart `userId` | **P1** |
| Warehouse creation failure surfacing | Silent | Low — user banner + admin notification | **P1** |
| Ethiopian VAT at cart/checkout | Missing | Medium | **P1** |
| Per-tenant supplier credentials auto-provision | Manual admin | Medium | **P1** |
| Dual-role stock transfer (buy WH → sell WH) | Missing automation | High — Stock Entry transfer workflow | **P2** |
| Partial receipt confirmation | TODO in API | Medium | **P2** |
| Marketplace per-supplier stock accuracy | Partial | Medium | **P2** |
| ERP reorder_level / reorder_qty integration | Partial | Low–Medium | **P2** |
| Supplier fulfillment beyond SO submit (DN, stock issue) | Missing | High | **P2** |
| Cart approval cart snapshot | Missing | Medium | **P2** |
| Guest catalog API exposes prices/tokens | By design / security | Low | **P2** |
| Payment methods (card, Net 30) | Placeholder UI | High | **P3** |
| Supplier dashboard analytics | Stubbed | High | **P3** |
| Product fulfillment rate | Placeholder | Medium | **P3** |
| KYC status duplicate fetches | Tech debt | Low | **P3** |
| `/api/register/check-credentials` unused | Dead code | Low | **P3** |

---

## Appendix: KYC step reference

| Step | UI | `suggestedStep` signal | App gate |
|------|-----|------------------------|----------|
| 1–2 | Credentials + OTP | — | — |
| 3 | Personal | `first_name !== "Pending"` | — |
| 4 | Organization | `companyName` | — |
| 5 | Licenses | EFDA, no TIN | — |
| 6 | Tax | TIN present | **`kycComplete`** (nav unlock) |
| 7 | Bank | — | Warehouses + bank accounts |

Team members inherit org KYC at `suggestedStep: 6` without individual wizard completion.

---

## Appendix: Documented TODOs (codebase search)

| File | TODO |
|------|------|
| `app/dashboard/layout.tsx` | Consolidate KYC status fetches |
| `app/api/vendor/catalog/route.ts` | Per-tenant API key |
| `app/api/vendor/inventory/route.ts` | Required idempotency key; per-tenant credentials |
| `app/api/dashboard/sales/orders/route.ts` | Per-tenant credentials |
| `app/api/dashboard/procurement/orders/confirm-receipt/route.ts` | Partial receipt |
| `app/api/marketplace/cart/route.ts` | Cart dedupe vs vendor alias rotation |
| `app/marketplace/checkout/page.tsx`, `cart/page.tsx` | Ethiopian VAT |
| `app/marketplace/product/[slug]/page.tsx` | Real fulfillment rate |
| `lib/marketplace-checkout-execute.ts` | Stale supplier email comment |
| `app/dashboard/sales/inventory/inventory-client.tsx` | ERP reorder fields; sales velocity |
| `components/dashboard/supplier-dashboard.tsx` | MTD analytics |
| `components/importer-shell.tsx` | Legacy component |

---

*Generated by read-only codebase audit. No application files were modified.*
