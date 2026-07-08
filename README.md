# Qevira

Qevira is a B2B pharmaceutical procurement marketplace for Ethiopian institutional buyers (hospitals, pharmacies) and suppliers (manufacturers, importers, wholesalers). Buyers browse a catalog of generic drugs with anonymized supplier pricing, place orders against verified inventory, and confirm receipt to trigger stock entries in the ERP. Suppliers manage listings, inventory, and incoming orders through a separate dashboard view. The platform operates under Ethiopian Food and Drug Authority (EFDA) licensing requirements, which shapes several data model and access control decisions. Production deployment: [qevira.michaelalene.com](https://qevira.michaelalene.com).

---

## Architecture

### Next.js App Router as the integration layer

The app uses Next.js 16 App Router with React 19. Server components handle catalog and dashboard data fetching directly against ERPNext — there are no client-side API waterfalls for the data-heavy views. Middleware at the edge protects `/dashboard` and all cart/checkout routes by validating the session JWT before any page code runs. Client components are narrow: quantity inputs, the cart sheet, filter panels, and the buying/selling mode toggle. This split keeps the authorization surface on the server and avoids exposing ERPNext credentials or supplier data to the browser.

### ERPNext as the system of record, Prisma/Turso for app state

ERPNext handles everything that belongs in a pharmaceutical ERP: item master, inventory bins, batch tracking, stock ledger, sales orders, and party data (Customer, Supplier). The app communicates with ERPNext over its Frappe REST API via `lib/erpnext-auth.ts`, which manages token-based auth with a Basic auth fallback on 401.

Prisma on Turso holds state that does not belong in ERP: shopping carts, OTP tokens, team memberships with role-based cart approval workflows, in-app notifications, bank account credentials (AES-256-GCM encrypted), and buyer-to-warehouse mapping. The schema declares `provider = "sqlite"` but at runtime `lib/prisma.ts` instantiates `PrismaLibSql` using `@prisma/adapter-libsql`. This means the local dev database is a plain SQLite file and production is Turso — no schema changes between environments, only environment variables.

This split was a deliberate choice: ERPNext's data model is rigid and optimized for accounting and inventory, not for application-layer session state. Mixing cart rows into ERPNext would complicate order creation, require custom doctypes for transient data, and tie application deployment to ERP migrations.

### Turso (libsql) over hosted Postgres

Turso provides SQLite-compatible storage with global edge replication. The migration path from local SQLite development to production Turso required only swapping the Prisma adapter — `@prisma/adapter-libsql` with a `libsql://` `DATABASE_URL` and a `DATABASE_AUTH_TOKEN`. The schema and all migrations are identical. For a single-region application with moderate write volume, the operational simplicity of this approach outweighs the replication benefits of Postgres.

### Supplier anonymization

Suppliers are never identified by name or ID in marketplace responses. `lib/anonymization.ts` computes a deterministic alias — `Vendor #NNNN` — using HMAC-SHA256 over `supplierId:ISO-year-week` with a secret salt (`SUPPLIER_ALIAS_SALT`). The alias rotates weekly so that cross-session tracking is limited. When a buyer adds an item to the cart, the server wraps supplier ID, price, and quantity constraints in a JWE token (`jose`, `dir`/`A256GCM`) signed with `OFFER_TOKEN_SECRET`. The client holds this opaque token and sends it back at checkout; the server decrypts it to recover supplier identity. The browser never sees a raw supplier ID or ERPNext document name.

### Tiered access control

Ethiopian pharmaceutical distribution is hierarchical: Manufacturers sell to Importers, Importers to Wholesalers, Wholesalers to institutional Buyers. The platform enforces this in `lib/tiers.ts` via the `canViewSupplier` function, which reads `supplier_group` from ERPNext. An Importer account can only see Manufacturer listings; a Wholesaler can only see Importer listings; Buyers see all suppliers. The check is server-side only, applied at catalog fetch time — there is no client-side visibility flag that could be bypassed. Supplier accounts always see their own listings regardless of tier.

### Rate limiting on auth endpoints

Login, OTP dispatch, and password reset are rate-limited per email address and IP using Redis via `ioredis`. The limits are enforced in `lib/rate-limit.ts` and applied in the relevant API route handlers. On a regulated platform where user accounts are tied to KYC-verified business licenses, credential stuffing carries higher risk than on a typical consumer app — an attacker that compromises a supplier account could manipulate inventory or pricing data visible to institutional buyers.

---

## Key technical decisions

- **JWT sessions via `jose`:** Session data is signed with `SESSION_SECRET` and stored in an httpOnly `bamys_session` cookie. Stateless sessions fit the App Router model where server components read the cookie directly without a round-trip to a session store. Redis is used for rate-limit state and some session helpers, not for session storage itself.

- **ERPNext custom fields:** EFDA registration numbers (`custom_efda_registration_no` on Item), warehouse mapping (`custom_warehouse` on Supplier), and license numbers (`custom_efda_license_no`, `custom_business_license_no` on Supplier/Customer) are stored as ERPNext custom fields. These must be created manually on the ERPNext instance before the app functions correctly.

- **Receipt confirmation → stock entry:** When a buyer confirms receipt of an order, the app creates an ERPNext Stock Entry in the buyer's mapped warehouse. This is the alpha mechanism for inventory deduction on the buyer side; it is intentionally all-or-nothing at this stage rather than partial fulfillment.

- **Resend for transactional email:** OTP delivery, password reset, and team invitations use Resend with a verified sending domain (`noreply@qevira.michaelalene.com`). `DEV_EMAIL_OVERRIDE` redirects all outbound email to a single address in development.

- **Deployment mirror:** The canonical source is a private org repository. A GitHub Actions workflow mirrors commits to a personal repository connected to a Vercel Hobby account. This separates team access control from deployment credentials.

---

## Local development

### Prerequisites

- Node.js 18+
- Redis (local instance on `redis://127.0.0.1:6379`)
- ERPNext instance accessible over HTTP/HTTPS (Docker setup recommended; must be publicly accessible or tunneled for webhook/API callbacks)

### Setup

```bash
git clone <repo>
cd united-pharma
npm install          # also runs prisma generate via postinstall
```

Copy `.env.example` to `.env.local` and fill in all values (see Environment Variables below).

```bash
# Apply database migrations
npx prisma migrate deploy

# Verify Turso connection (optional)
npx tsx scripts/verify-turso-prisma.ts

# Start dev server
npm run dev
```

For local development, set `DATABASE_URL=file:./dev.db` and omit `DATABASE_AUTH_TOKEN`. Prisma will use a local SQLite file.

### ERPNext setup

The ERPNext instance requires:

1. An API key/secret pair with sufficient permissions (Item, Item Price, Bin, Sales Order, Stock Entry, Customer, Supplier, Address)
2. Custom fields created via Frappe's Customize Form:
   - `custom_warehouse` on Supplier (Link → Warehouse)
   - `custom_efda_registration_no` on Item (Data)
   - `custom_efda_license_no` on Supplier and Customer (Data)
   - `custom_business_license_no` on Supplier and Customer (Data)
3. A parent warehouse matching `ERPNEXT_PARENT_WAREHOUSE`
4. The company name matching `ERPNEXT_COMPANY_NAME`

### Validation

```bash
npm run validate     # eslint + prisma validate + tsc --noEmit
npm run build        # prisma generate + next build
```

---

## Environment variables

### ERPNext connection

| Variable | Description |
|---|---|
| `ERPNEXT_URL` | Base URL of the ERPNext instance (e.g. `https://erp.example.com`) |
| `ERPNEXT_SITE_NAME` | Frappe `X-Frappe-Site-Name` header value; defaults to `frontend` if unset |
| `ERPNEXT_API_KEY` | API token key for ERPNext authentication |
| `ERPNEXT_API_SECRET` | API token secret for ERPNext authentication |
| `ERPNEXT_COMPANY_NAME` | Company name used when creating supplier warehouses |
| `ERPNEXT_PARENT_WAREHOUSE` | Parent warehouse under which supplier `WH-*` warehouses are created |
| `ERPNEXT_BUYER_WAREHOUSE` | Parent warehouse group for buyer inventory warehouses; created automatically on buyer KYC completion |

### Auth and encryption

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Signing key for `bamys_session` JWT cookies |
| `OFFER_TOKEN_SECRET` | Base64-encoded 32-byte key for JWE offer tokens (must decode to exactly 32 bytes) |
| `SUPPLIER_ALIAS_SALT` | HMAC salt for weekly-rotating vendor alias computation |
| `RESET_TOKEN_SECRET` | Signing key for password reset tokens |
| `CREDENTIAL_ENCRYPTION_SECRET` | AES-256-GCM key for encrypting supplier bank credentials at rest |

### Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | Turso `libsql://` URL in production; `file:./dev.db` for local SQLite |
| `DATABASE_AUTH_TOKEN` | Turso authentication token (omit for local `file:` URLs) |

### Email

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key; sends from `noreply@qevira.michaelalene.com` |
| `NEXT_PUBLIC_APP_URL` | Absolute base URL used to construct links in outbound emails |
| `DEV_EMAIL_OVERRIDE` | If set and `NODE_ENV=development`, redirects all outbound email to this address |
| `ADMIN_NOTIFICATION_EMAIL` | Recipient for admin alert emails |

### Infrastructure

| Variable | Description |
|---|---|
| `REDIS_URL` | Redis connection URL for rate limiting (e.g. `redis://127.0.0.1:6379` or Upstash TLS URL) |
| `ADMIN_API_KEY` | Bearer token for internal admin API routes |

---

## Deployment

- **Frontend:** Vercel (Hobby), deployed via GitHub Actions mirror from the org repository to a personal repository
- **Database:** Turso — `libsql://` URL with auth token; `prisma generate` runs automatically in both `postinstall` and `build` scripts
- **ERPNext:** Self-hosted Docker; must be publicly accessible from Vercel's edge (no VPN tunnel in current setup)
- **Redis:** Self-hosted or managed (Upstash); the `REDIS_URL` in `.env.example` includes an Upstash TLS format comment
