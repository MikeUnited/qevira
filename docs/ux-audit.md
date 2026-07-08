# Qevira UX Audit

**Date:** 2026-06-26  
**Scope:** Read-only audit of all user types, features, flows, gaps, and friction points.  
**Method:** Full codebase read — `lib/`, `app/`, `app/api/`, `prisma/schema.prisma`, `middleware.ts`.

---

## Part 1: User Types

### 1. Guest (unauthenticated)

**Definition:** No session cookie. Middleware allows access to `/marketplace` but blocks `/marketplace/cart`, `/marketplace/checkout`, and all `/dashboard/*` routes.

**Can see:**
- Marketplace catalog (product names, item group, expiry, stock indicator, supplier count)
- Product detail pages
- Prices are hidden — rows show "Sign in to view pricing" / "Sign in to purchase"
- Supplier aliases are shown but pricing and checkout are locked

**Can do:**
- Browse and filter the catalog (search, category, expiry range, vendor alias, stock status)
- View product detail pages
- Navigate to `/login` and `/register`

**Cannot do:**
- Add to cart (redirected to login)
- See prices or supplier identity beyond alias
- Access any dashboard feature

---

### 2. Manufacturer (Tier 0 supplier)

**Definition:** ERPNext `supplier_group = "Manufacturer"`. `TIER_MAP["Manufacturer"] = 0`. `getAllowedSupplierGroups()` returns `[]` — no upstream suppliers to buy from.

**Can see:**
- Marketplace catalog (but no suppliers are visible to them — `canViewSupplier` returns false for all unless own listing)
- Own listings in the catalog
- `/dashboard/sales/*` — supplier dashboard, orders, inventory, stock

**Can do:**
- Manage own catalog items (via ERPNext; item creation not self-service in app)
- Add stock entries (`/dashboard/sales/stock`)
- Manage inventory (`/dashboard/sales/inventory`)
- View incoming sales orders (`/dashboard/sales/orders`)
- Invite team members (OWNER role)

**Cannot do:**
- Buy from the marketplace (no upstream tier)
- Access `/dashboard/procurement/*` (no customer ERPNext doc)
- Use the buying mode toggle meaningfully

---

### 3. Importer (Tier 1 supplier, dual-role capable)

**Definition:** ERPNext `supplier_group = "Importer"`. `TIER_MAP["Importer"] = 1`. `getAllowedSupplierGroups()` returns `["Manufacturer"]`.

**Can see:**
- Marketplace: only Manufacturer listings (server-side filtered via `canViewSupplier`)
- Own listings (always visible)
- `/dashboard/sales/*` as supplier
- `/dashboard/procurement/*` if also registered as an ERPNext Customer

**Can do:**
- All Manufacturer supplier actions (sell, stock, inventory, orders)
- Buy from Manufacturers if they have a Customer ERPNext record (`isDualRole = true`)
- Toggle between buying and selling mode (mode-context.tsx, persisted to localStorage)
- Place procurement orders against Manufacturer stock

**Gap:** Dual-role status depends on having both a Supplier and Customer record in ERPNext. Registration flow creates one or the other — there is no in-app path to add the second role post-registration. Requires manual ERPNext admin to create the Customer record for an existing Supplier.

---

### 4. Wholesaler (Tier 2 supplier, dual-role capable)

**Definition:** ERPNext `supplier_group = "Wholesaler"`. `TIER_MAP["Wholesaler"] = 2`. `getAllowedSupplierGroups()` returns `["Importer"]`.

**Can see:**
- Marketplace: only Importer listings
- Own listings
- `/dashboard/sales/*` and `/dashboard/procurement/*` (if dual-role)

**Can do:** Same pattern as Importer, shifted one tier down. Same dual-role gap applies.

---

### 5. Buyer / Hospital / Pharmacy (Customer only)

**Definition:** ERPNext Customer record exists; no Supplier record. `customerGroup` set, `supplierGroup` null. `getAllowedSupplierGroups()` returns `null` → ALL suppliers visible.

**Can see:**
- Full marketplace catalog (all tiers visible)
- `/dashboard/procurement/*` — orders, approvals
- `/dashboard/inventory` — buyer warehouse stock

**Can do:**
- Browse and purchase from all suppliers
- View procurement orders and confirm receipt
- Manage team (invite DIRECTOR, PHARMACIST)
- Cart approval flow as OWNER/DIRECTOR

**Cannot do:**
- Access `/dashboard/sales/*` (no supplier record)
- Add stock entries or manage supplier inventory

---

### 6. OWNER (TeamRole within a buyer organisation)

**Definition:** `TeamMember.role = OWNER`, `organizationKind = CUSTOMER`. Set during registration — the founding member of an organisation is automatically OWNER.

**Permissions (relative to DIRECTOR):**
- Can invite DIRECTOR and PHARMACIST
- Can revoke any team member (including DIRECTOR; cannot revoke self)
- Can place orders directly (no approval required)
- Can approve PHARMACIST cart requests
- Full access to all procurement and inventory features

---

### 7. DIRECTOR (TeamRole within a buyer organisation)

**Definition:** `TeamMember.role = DIRECTOR`, `organizationKind = CUSTOMER`. Invited by OWNER.

**Permissions:**
- Can invite PHARMACIST (cannot invite DIRECTOR)
- Can revoke PHARMACIST only
- Can place orders directly
- Can approve PHARMACIST cart requests (`/dashboard/procurement/approvals`)
- Full procurement visibility

---

### 8. PHARMACIST (TeamRole within a buyer organisation)

**Definition:** `TeamMember.role = PHARMACIST`, `organizationKind = CUSTOMER`. Invited by OWNER or DIRECTOR.

**Permissions:**
- Can browse marketplace and add to cart
- **Cannot place orders directly** — checkout API blocks PHARMACIST role, creates a `CartApprovalRequest` instead
- Must wait for DIRECTOR or OWNER approval
- Cannot invite team members
- Cannot revoke team members
- Cannot access `/dashboard/procurement/approvals`

**Gap:** After submitting a cart for approval, the PHARMACIST has no in-app visibility into the status of their approval request. They receive no notification when approved or rejected. The `Notification` table has an `APPROVAL_REQUEST` type but there is no evidence notifications are sent back to the requesting PHARMACIST.

---

## Part 2: Feature Inventory

### Guest features

| Feature | Route | Status |
|---|---|---|
| Browse catalog | `GET /api/marketplace/catalog` | Complete |
| Search & filter | Client-side on `/marketplace` | Complete |
| Product detail | `/marketplace/product/[slug]` | Partial — fulfillment rate is a placeholder |
| View stock indicator | Dot indicators on catalog rows | Complete |
| View expiry | Per offer row | Complete |

### Supplier features (all tiers)

| Feature | Route | Status |
|---|---|---|
| Supplier dashboard overview | `/dashboard/sales` | Complete |
| View sales orders | `/dashboard/sales/orders` | Partial — uses global API key, not per-tenant |
| View inventory | `/dashboard/sales/inventory` | Partial — reorder level/qty hardcoded (proxy max 200) |
| Add stock entry | `/dashboard/sales/stock` → `POST /api/vendor/inventory` | Partial — idempotency key not required yet |
| View own catalog listings | `GET /api/vendor/catalog` | Partial — uses global API key |
| Create new catalog item | — | **Missing** — no in-app item creation; requires ERPNext admin |
| Edit item details (price, UOM) | — | **Missing** — no in-app item editing |
| View supplier catalog list | `GET /api/vendor/catalog/list` | Complete |
| Invite team members | `/dashboard/settings/team` | Complete |
| Revoke team members | `/dashboard/settings/team` | Complete |

### Buyer features

| Feature | Route | Status |
|---|---|---|
| Browse marketplace | `/marketplace` | Complete |
| Add to cart | `POST /api/marketplace/cart` | Complete |
| Update cart quantity | `PATCH /api/marketplace/cart` | Complete |
| Remove cart item | `DELETE /api/marketplace/cart` | Complete |
| View cart | `/marketplace/cart` | Partial — tax not calculated |
| Checkout (OWNER/DIRECTOR) | `POST /api/marketplace/checkout/order` | Partial — bank transfer only; tax not calculated |
| Request cart approval (PHARMACIST) | `POST /api/team/cart/request-approval` | Complete |
| View cart approval requests (DIRECTOR/OWNER) | `/dashboard/procurement/approvals` | Complete |
| Approve/reject cart request | `PUT /api/team/cart/approvals` | Complete |
| View procurement orders | `/dashboard/procurement/orders` | Complete |
| Confirm receipt | `POST /api/dashboard/procurement/orders/confirm-receipt` | Partial — all-or-nothing, no partial receipt |
| Request order cancellation | `POST /api/dashboard/procurement/orders/cancel-request` | Complete |
| View buyer inventory | `/dashboard/inventory` → `GET /api/dashboard/inventory/buyer` | Complete |
| Manual stock reduction | `PATCH /api/dashboard/inventory/buyer/reduce` | Complete |
| Invite team | `/dashboard/settings/team` | Complete |

### Shared / system features

| Feature | Route | Status |
|---|---|---|
| OTP login | `/api/auth/otp/*` | Complete |
| Password reset | `/api/auth/forgot-password`, `/api/auth/reset-password` | Complete |
| KYC registration wizard | `/register`, `/complete-kyc`, `/api/register/kyc/*` | Complete |
| Team invitation acceptance | `/invite/accept` | Complete |
| In-app notifications | `/api/notifications/*` | Partial — notification bell exists; some trigger points missing (e.g. PHARMACIST not notified of approval outcome) |
| ERPNext health check | `/api/erpnext-health` | Complete |
| Supplier credential management | `/api/admin/supplier-credentials` | Partial — admin-only; per-tenant provisioning not implemented |

---

## Part 3: User Flow Mapping

### Flow 1: Supplier onboarding

| Step | Route / Component | Status |
|---|---|---|
| 1. Register (email + password + OTP) | `/register` → `/api/register/init`, `/api/auth/otp/*` | ✅ Complete |
| 2. Personal details | `/register` → `/api/register/personal-details` | ✅ Complete |
| 3. Organisation KYC | `/complete-kyc` → `/api/register/kyc/organization` | ✅ Complete |
| 4. Licences KYC (EFDA, business) | `/api/register/kyc/licenses` | ✅ Complete |
| 5. Tax KYC | `/api/register/kyc/tax` | ✅ Complete |
| 6. Bank account KYC | `/api/register/kyc/bank` | ✅ Complete |
| 7. Warehouse auto-created on bank KYC | `lib/erpnext-warehouse.ts` via bank KYC route | ✅ Complete (errors logged, not thrown) |
| 8. Add catalog item | — | ❌ **Missing** — no in-app path; requires manual ERPNext admin to create Item doctype |
| 9. Add stock to item | `/dashboard/sales/stock` → `POST /api/vendor/inventory` | ✅ Complete |
| 10. Item appears in marketplace | `GET /api/marketplace/catalog` fetches ERPNext Items | ✅ Complete (once item exists in ERPNext) |

**Critical gap:** Step 8 has no in-app equivalent. A newly onboarded supplier cannot list products without ERPNext admin access. The entire onboarding flow stalls between step 7 and step 9 for net-new suppliers.

---

### Flow 2: Buyer procurement (direct)

| Step | Route / Component | Status |
|---|---|---|
| 1. Register | `/register` | ✅ Complete |
| 2. Complete KYC | `/complete-kyc` | ✅ Complete |
| 3. Browse marketplace | `/marketplace` | ✅ Complete |
| 4. Add to cart | `POST /api/marketplace/cart` | ✅ Complete |
| 5. Review cart | `/marketplace/cart` | ⚠️ Partial — tax not shown (shows "calculated at invoice") |
| 6. Checkout & place order | `POST /api/marketplace/checkout/order` → ERPNext Sales Order | ⚠️ Partial — bank transfer only; no card or Net 30 |
| 7. Order appears in supplier dashboard | `/dashboard/sales/orders` | ⚠️ Partial — uses global API key, not supplier-specific |
| 8. Supplier fulfils (marks order delivered) | `/dashboard/sales/orders` (SupplierOrdersClient) | ⚠️ Needs verification — unclear if the UI exposes a fulfil/deliver action or only shows order status |
| 9. Buyer confirms receipt | `POST /api/dashboard/procurement/orders/confirm-receipt` | ⚠️ Partial — all-or-nothing; no partial receipt |
| 10. ERPNext Stock Entry created in buyer warehouse | `marketplace-checkout-execute.ts` / confirm-receipt route | ✅ Complete (warehouse resolved via `BuyerWarehouse` table) |
| 11. Stock appears in buyer inventory | `GET /api/dashboard/inventory/buyer` | ✅ Complete |

**Gaps:**
- Tax display is deferred to invoice — buyers cannot see the final amount before ordering.
- Payment is bank transfer only — procurement officers cannot pay by card or on credit terms.
- Step 8 (supplier fulfils) needs verification; the supplier orders UI may not expose a fulfilment action that closes the order in ERPNext.

---

### Flow 3: Buyer procurement (team / PHARMACIST)

| Step | Route / Component | Status |
|---|---|---|
| 1. PHARMACIST browses marketplace | `/marketplace` | ✅ Complete |
| 2. PHARMACIST adds to cart | `POST /api/marketplace/cart` | ✅ Complete |
| 3. PHARMACIST attempts checkout | `POST /api/marketplace/checkout/order` | ✅ Blocked correctly — creates `CartApprovalRequest` |
| 4. PHARMACIST submits for approval | `POST /api/team/cart/request-approval` | ✅ Complete |
| 5. PHARMACIST receives confirmation | Checkout page message | ✅ Complete (UI shows "submitted for approval") |
| 6. DIRECTOR/OWNER notified of request | `Notification` (APPROVAL_REQUEST type) | ⚠️ Partial — notification type exists in schema but it is unclear if a notification is reliably created and surfaced |
| 7. DIRECTOR views pending approvals | `/dashboard/procurement/approvals` | ✅ Complete |
| 8. DIRECTOR approves & order is placed | `PUT /api/team/cart/approvals` → `POST /api/marketplace/checkout/order` | ✅ Complete |
| 9. PHARMACIST notified of outcome | — | ❌ **Missing** — no notification sent back to PHARMACIST after approval or rejection |
| 10. Remainder of flow (steps 7–11 of Flow 2) | — | Same as Flow 2 |

**Critical gap:** Step 9 — the PHARMACIST who submitted the request has no in-app way to know whether it was approved or rejected. They must either ask their director or check back on the orders list. This creates an operational dead end for the approval workflow.

---

### Flow 4: Dual-role user (Importer or Wholesaler buying upstream)

| Step | Route / Component | Status |
|---|---|---|
| 1. User registers as Importer/Wholesaler | `/register` | ✅ Complete |
| 2. ERPNext Supplier record created | KYC → ERPNext via Frappe REST | ✅ Complete |
| 3. ERPNext Customer record also created | — | ❌ **Missing** — registration flow creates Supplier OR Customer, not both. No in-app path to add the second role. Requires manual ERPNext admin. |
| 4. Dual-role detected (`isDualRole = true`) | `lib/server-user-profile.ts` | ✅ Complete (once both records exist) |
| 5. Mode toggle shows buying/selling | `mode-context.tsx`, dashboard page | ✅ Complete |
| 6. User browses marketplace in buying mode | `/marketplace` (filtered to allowed upstream tier) | ✅ Complete |
| 7. User places procurement order | Same as Flow 2 | ✅ Complete |
| 8. User confirms receipt; stock enters own warehouse | Confirm receipt → Stock Entry in `custom_warehouse` | ✅ Complete |
| 9. User switches to selling mode | Mode toggle | ✅ Complete |
| 10. Received stock now available in own catalog | ERPNext Bin updated by Stock Entry | ✅ Complete |
| 11. Downstream buyer orders it | Same as Flow 2 | ✅ Complete |

**Critical gap:** Step 3 — the dual-role path requires manual ERPNext admin intervention to create the second party record. An Importer who wants to also buy from Manufacturers has no in-app path to request or complete this. The app has no "I also want to buy" registration option.

---

### Flow 5: Stock management

| Step | Route / Component | Status |
|---|---|---|
| 1. Supplier adds stock entry | `/dashboard/sales/stock` → `POST /api/vendor/inventory` | ✅ Complete |
| 2. ERPNext Bin updated | ERPNext Stock Entry via Frappe REST | ✅ Complete |
| 3. Stock appears in marketplace | `GET /api/marketplace/catalog` reads Bin | ✅ Complete (next catalog fetch) |
| 4. Buyer places order → stock reserved | ERPNext Sales Order | ✅ Complete |
| 5. Stock reduced on delivery + receipt confirmation | Stock Entry on confirm-receipt | ✅ Complete |
| 6. Reorder alert triggered | `/dashboard/sales/inventory` (SalesInventoryClient) | ⚠️ Partial — reorder_level uses placeholder 0; proxy max is hardcoded 200; no real ERPNext Min/Max fields read |
| 7. Sales velocity analytics | — | ❌ **Missing** — no order analytics built yet; reorder_qty cannot be calculated |

---

## Part 4: Friction Points

### Dead ends

| Location | Problem |
|---|---|
| `/success` page | User is told "account under review" but there is no ETA, no contact path, no status polling, and no next action. Users land here and have nowhere to go. |
| PHARMACIST post-approval submission | After submitting a cart for approval, the PHARMACIST sees a success message but has no ongoing status view — no "pending approvals" tab, no notification on outcome. |
| Supplier post-onboarding | After completing KYC and warehouse creation, the supplier dashboard shows no items and no path to add them. The supplier must contact an admin to get products into ERPNext. |

### Errors with no recovery path

| Location | Problem |
|---|---|
| Warehouse creation failure (KYC bank step) | Errors are logged only — the session is created regardless. If warehouse creation silently fails, the supplier cannot receive stock. There is no admin alert or retry mechanism shown in the UI. |
| ERPNext unavailable on dashboard load | Dashboard layout renders a 403 gracefully, but the user cannot distinguish a temporary outage from a permissions problem. No retry or status page. |
| Cart idempotency collision | If a duplicate checkout request is detected, the existing order is returned silently. The user gets a success response but it's not clear whether a new order was placed or the previous one returned. |

### UI features backed by incomplete APIs

| Feature | Gap |
|---|---|
| Tax display at cart and checkout | Shows "calculated at invoice" — no Ethiopian VAT calculation implemented. Buyers cannot see the real total before confirming. |
| Payment method selector at checkout | Shows Bank Transfer as only active option; "Credit / Debit Card" and "Net 30" are rendered but labelled "Coming Soon". These are non-functional UI elements. |
| Fulfillment rate on product detail page | Placeholder value — no order tracking data exists to compute it. |
| Reorder level and quantity in inventory | Hardcoded proxy max (200); reorder_level always 0. The reorder alert system cannot function correctly. |
| Per-tenant supplier API key | All supplier catalog and inventory API calls use a global ERPNext API key. EFDA audit trail cannot distinguish between suppliers at the API level. |

### Flows requiring manual admin intervention

| Flow step | What should happen | What actually happens |
|---|---|---|
| Supplier onboards → wants to add products | App should allow item creation or item-request workflow | Must contact ERPNext admin to create Item doctypes |
| Importer/Wholesaler wants to also buy | App should offer dual-role registration | Must contact ERPNext admin to create second party record |
| Supplier credentials provisioned | App should auto-provision per-tenant credentials on KYC completion | Admin must manually enter credentials via `/api/admin/supplier-credentials` |
| Warehouse creation fails silently | System should alert admin and allow retry | Error is logged only; no admin alert; no user feedback |

---

## Part 5: Priority Matrix

| Flow / Issue | Status | Effort to fix | Priority |
|---|---|---|---|
| Supplier cannot add catalog items (Flow 1, step 8) | Missing entirely | High — requires ERPNext Item creation form + Frappe REST integration | P0 — blocks supplier onboarding end-to-end |
| PHARMACIST not notified of approval outcome (Flow 3, step 9) | Missing entirely | Low — add notification creation in approval PUT handler | P0 — breaks the core team procurement loop |
| Dual-role registration path (Flow 4, step 3) | Missing entirely | Medium — add registration option + Customer doctype creation on KYC | P0 — dual-role is a core business model for importers/wholesalers |
| Tax calculation (cart + checkout) | Partial — deferred to invoice | Medium — requires Ethiopian VAT rules implementation | P1 — buyers cannot make informed purchasing decisions |
| Per-tenant supplier credentials | Partial — global key used | Medium — provisioning flow exists in admin API; needs auto-trigger on KYC | P1 — EFDA audit trail requirement |
| Reorder level / qty from ERPNext | Partial — hardcoded proxy | Low — read `reorder_level` and `reorder_qty` from ERPNext Item doctype | P1 — inventory management is non-functional without real thresholds |
| `/success` page dead end | Missing next action | Low — add status polling or contact path | P1 — users under review have no recourse |
| Warehouse creation failure alerting | Silent failure | Low — send admin notification on warehouse create error | P1 — silent failure can leave supplier unable to receive stock |
| Supplier fulfil action verification | Needs verification | Low (read-only check) | P1 — Flow 2 step 8 unverified |
| Partial receipt confirmation | Partial — all-or-nothing | Medium — requires ERPNext partial delivery Stock Entry logic | P2 — workaround is full confirmation |
| Payment methods (card, Net 30) | UI placeholder only | High — external payment gateway integration required | P2 — bank transfer covers alpha use cases |
| Cart idempotency UX clarity | Ambiguous on duplicate | Low — return explicit `alreadyPlaced: true` flag to UI | P2 — edge case |
| Sales velocity / order analytics | Missing | High — requires analytics pipeline | P3 — needed for reorder_qty calculation |
| Product fulfillment rate | Placeholder | Medium — requires order completion tracking | P3 — informational only at this stage |
| KYC status duplicate fetches | Performance only | Low — consolidate into server context | P3 — technical debt, not user-visible |
