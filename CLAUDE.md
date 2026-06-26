# CLAUDE.md — Qevira (united-pharma)

## Project identity

**Qevira** (npm package `united-pharma`) is a B2B pharmaceutical marketplace and dashboard for Ethiopian institutional buyers and suppliers. The Next.js app fronts **ERPNext** for catalog, inventory, orders, and KYC party data; **Prisma on Turso (libsql)** stores sessions-adjacent app state (cart, OTP, team, notifications, bank accounts). Production: **https://qevira.michaelalene.com**. UI brand: **BAMYS**.

## Stack

| Layer | Technology | Version / notes |
|-------|------------|-----------------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2.3 |
| ORM | Prisma + `@prisma/adapter-libsql` + `@libsql/client` | Prisma 7.6.0 / adapter 7.8.0 / client 0.17.4 |
| ERP | ERPNext / Frappe REST | via `lib/erpnext-auth.ts` |
| Cache / limits | Redis (`ioredis`) | 5.10.1 — sessions helper, rate limits |
| Auth tokens | `jose` | 6.2.2 — session JWT + offer JWE (`dir` / `A256GCM`) |
| Email | Resend | 6.10.0 — `from: noreply@qevira.michaelalene.com` |
| Styling | Tailwind CSS 4 + Shadcn UI (`components/ui/*`) + Lucide | see `DESIGN.md` |
| Validation | Zod | 4.3.6 |

**Not used:** Sanity CMS.

**Note:** `prisma/schema.prisma` declares `provider = "sqlite"`; runtime uses `PrismaLibSql` in `lib/prisma.ts` with `DATABASE_URL` + `DATABASE_AUTH_TOKEN`.

## Directory map

```
app/
  marketplace/          Public catalog, cart, checkout, product detail
  dashboard/            Authenticated buyer/supplier shell (procurement, sales, settings, team)
  register/, login/, complete-kyc/, invite/
  api/
    auth/               OTP, forgot/reset password, me
    marketplace/        catalog, cart, checkout
    dashboard/          procurement + sales orders
    register/           KYC wizard + bank sync
    team/               invites, members, cart approvals
    notifications/      in-app notifications
    vendor/             supplier catalog + inventory
    erpnext-health/     connectivity check
lib/                    Server utilities (see below)
components/
  ui/                   Shadcn primitives
  bamys-dashboard-shell.tsx, marketplace/marketplace-top-nav.tsx
  layout/user-account-nav.tsx, notifications/notification-bell.tsx
  registration/         KYC wizard
contexts/
  mode-context.tsx      Buying / selling toggle (localStorage `qevira-mode`)
prisma/
  schema.prisma         App DB models
  migrations/           SQL migrations (apply with `prisma migrate deploy`)
scripts/                Turso verify, ERPNext debug, bank encryption backfill
```

### Key `lib/` modules

- `erpnext-auth.ts` — ERPNext fetch; token auth, Basic retry on 401, `X-Frappe-Site-Name`
- `erpnext-warehouse.ts` — supplier warehouse create/link (`custom_warehouse`)
- `get-buyer-profile.ts` — `getBuyerContext` / `getBuyerContextForEmail` (direct + team buyer)
- `tiers.ts` — supplier tier visibility (`canViewSupplier`)
- `anonymization.ts` — weekly rotating `Vendor #XXXX` aliases (`SUPPLIER_ALIAS_SALT`)
- `session.ts` / `session-redis.ts` — `bamys_session` cookie JWT
- `rate-limit.ts` / `redis.ts` — Redis-backed limits
- `marketplace-checkout-execute.ts` — checkout orchestration
- `notifications-service.ts` — Prisma notifications
- `server-user-profile.ts` — ERPNext Customer/Supplier groups for nav and gates
- `register-kyc.ts`, `bank-account-storage.ts`, `credential-encryption.ts`

## Hard rules (from code)

### ERPNext warehouse (`lib/erpnext-warehouse.ts`)

- Supplier warehouses: `WH-{UPPERCASE-SLUG}` under `ERPNEXT_PARENT_WAREHOUSE` / `ERPNEXT_COMPANY_NAME`.
- `ensureSupplierWarehouse` returns existing name on 200; creates on 404; **throws** on other check/create failures.
- `linkWarehouseToSupplier` writes `custom_warehouse` on Supplier; **logs errors, does not throw**.

### Warehouse vs session (`app/api/register/kyc/bank/route.ts`)

- After bank KYC, warehouse automation runs in **try/catch**; failures are logged only.
- `createSession` runs **after** warehouse block; response includes `sessionCreated` even if warehouse failed.

### DuplicateEntryError (not in `erpnext-warehouse.ts`)

- **`app/api/register/kyc/bank/route.ts`**: ERPNext bank sync treating `DuplicateEntryError` / `Duplicate entry` as **success** (warn + continue). Prisma `P2002` on local bank rows also treated as success.

### Buyer resolution (`lib/get-buyer-profile.ts`)

- **`getBuyerContext`**: direct buyer if `customerGroup` + ERPNext Customer by email; else accepted `TeamMember` with `organizationKind: CUSTOMER` and existing Customer doc.
- **`getBuyerContextForEmail`**: same without session profile (cart approvals).

### ERPNext custom fields (used in code)

| Field | DocType | Usage |
|-------|---------|--------|
| `custom_warehouse` | Supplier | Stock, catalog list, checkout, inventory (required for supplier ops) |
| `custom_efda_registration_no` | Item | Marketplace + vendor catalog display |
| `custom_efda_license_no` | Supplier / Customer | KYC resume |
| `custom_business_license_no` | Supplier / Customer | KYC resume |

`ERPNEXT_BUYER_WAREHOUSE` is in `.env.example` only — **not referenced in TS** yet.

### Tier visibility (`lib/tiers.ts`)

- Buyers without supplier group: **ALL** suppliers.
- Importer → Manufacturer only; Wholesaler → Importer only.
- Manufacturer suppliers: **no upstream** (empty allow list).
- `canViewSupplier`: always allow own listing (`viewerSupplierId === targetSupplierId`).

### Supplier aliases (`lib/anonymization.ts`)

- HMAC-SHA256 over `supplierId:ISO-year-week` + `SUPPLIER_ALIAS_SALT` → `Vendor #NNNN` (4 digits).
- Rotates weekly (UTC week in code).

### Marketplace catalog (`app/api/marketplace/catalog/route.ts`)

- Item fetch failure → 500.
- Item Price / Bin failures → **log + empty arrays** (non-fatal; do not regress).

### Offer tokens

- `OFFER_TOKEN_SECRET` must be base64 decoding to **32 bytes**.
- Cart/checkout decrypt offer JWE with `jose`.

## Environment variables

From `.env.example`:

| Variable | Purpose |
|----------|---------|
| `ERPNEXT_URL` | ERPNext base URL |
| `ERPNEXT_SITE_NAME` | Frappe site header (default fallback `frontend`) |
| `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` | API token pair |
| `ERPNEXT_COMPANY_NAME` | Company on Warehouse create |
| `ERPNEXT_PARENT_WAREHOUSE` | Parent warehouse for supplier WH-* |
| `ERPNEXT_BUYER_WAREHOUSE` | Documented buyer group warehouse (not wired in code) |
| `SESSION_SECRET` | Session JWT signing |
| `OFFER_TOKEN_SECRET` | Base64 32-byte key for offer JWE |
| `SUPPLIER_ALIAS_SALT` | Weekly vendor alias HMAC salt |
| `DATABASE_URL` | Turso `libsql://…` or local `file:` |
| `DATABASE_AUTH_TOKEN` | Turso auth (omit for local file DB) |
| `RESEND_API_KEY` | Transactional email |
| `RESET_TOKEN_SECRET` | Password reset tokens |
| `NEXT_PUBLIC_APP_URL` | Absolute links in emails |
| `DEV_EMAIL_OVERRIDE` | Dev-only OTP/forgot redirect (requires `NODE_ENV=development`) |
| `ADMIN_NOTIFICATION_EMAIL` | Admin alerts |
| `CREDENTIAL_ENCRYPTION_SECRET` | Supplier credential encryption |
| `REDIS_URL` | Redis for rate limits / session helpers |
| `ADMIN_API_KEY` | Admin API routes |

## Commands

```bash
npm run dev          # Next dev server
npm run build        # prisma generate && next build
npm run validate     # eslint + prisma validate + tsc
npx prisma migrate deploy
npx tsx scripts/verify-turso-prisma.ts
```

UI tokens, component inventory, and UX conventions: **`DESIGN.md`**.

## Conventions (not enforced in code)

- No consumer **star ratings** on active marketplace UI (supplier count only).
- **Faire.com** (marketplace structure) and **Fullscript** (compliance display) are design references — not cited in source.
- `.compliance-field` CSS class: **not present** in codebase.
