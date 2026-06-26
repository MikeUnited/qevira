# DESIGN.md — Qevira / BAMYS UI

## Current styling setup

- **Tailwind CSS v4** via `@import "tailwindcss"` in `app/globals.css`
- **Shadcn v4** via `@import "shadcn/tailwind.css"` and components in `components/ui/`
- **tw-animate-css** for animations
- **Font:** Geist Sans from `next/font/google` (`--font-geist-sans` on `<html>` in `app/layout.tsx`)
- **Dark mode:** `.dark` class variant (`@custom-variant dark (&:is(.dark *))`)
- **Legacy mirror:** `tailwind.config.ts` extends a small BAMYS token set (also commented as mirrored in globals)

### Design tokens

#### `tailwind.config.ts` (`theme.extend`)

| Token | Value |
|-------|--------|
| `colors.brand` | `#4f46e5` |
| `colors.surface` | `#f9fafb` |
| `colors.border-ui` | `#e5e7eb` |
| `colors.border-in` | `#d1d5dc` |
| `colors.txt-1` / `txt-2` / `txt-3` | `#0a0a0a` / `#4a5565` / `#6a7282` |
| `colors.warn` / `warn-bg` / `warn-br` | `#e17100` / `#fffbeb` / `#fee685` |
| `fontFamily.mono` | Menlo, Monaco, Courier New, monospace |
| `borderRadius.card` | `10px` |

#### `app/globals.css` (`:root` / `.dark`)

Semantic Shadcn variables (oklch + hex):

- **Primary / ring / sidebar-primary:** `#4f46e5` (indigo); ring dark accent `#4338ca` / `#6366f1`
- **Background:** near-white light / dark `oklch(0.18…)`
- **Destructive:** red oklch scales
- **Radius base:** `--radius: 0.5rem` with derived `--radius-sm` … `--radius-4xl`
- **Sidebar:** dedicated `--sidebar-*` palette

Comment in `:root`: *"Medical aesthetic: clean whites, zinc/slate grays, indigo primary (aligned with marketplace)"*.

#### Spacing / control height

- Default inputs: **`h-11`** (`components/ui/input.tsx`)
- Marketplace top nav / headers: `h-14`–`h-16`, sticky `top-0`, backdrop blur patterns in layouts

#### Typography

- Body: `font-sans` → Geist via CSS variable
- `--font-mono` in `@theme inline` maps to Geist Sans (not a separate mono face) — but components apply `font-mono` + `tabular-nums` for numeric data

---

## Design Direction

### Target register
Modern B2B SaaS — clean, fast, confident.
Not clinical or government-form heavy.
Reference quality: Linear (speed and clarity),
Vercel dashboard (data density without clutter).
The marketplace is the primary product surface
and first impression for new customers.

### The marketplace is the hero
Every design decision on /marketplace pages
should optimise for one thing: helping a
procurement officer decide what to order
faster and with more confidence than any
alternative. Speed of decision, not beauty,
is the success metric.

### Seven specific problems to fix on the catalog
(in priority order)

1. Page title "Marketplace" wastes prime real estate.
   Replace with a functional element — a prominent
   search bar or a category quick-filter strip.

2. "Verified Supplier" repeated on every offer row
   is noise. All suppliers are verified — this signal
   belongs once per product card (as a subtle badge)
   not on every price row.

3. The category badge (top right of each card) is
   visually disconnected from the product name.
   Move it adjacent to the product name as an inline
   pill, not a floating corner element.

4. "Batch: Standard" appears on every row and means
   nothing to the buyer. Replace with the actual
   batch number (e.g. "Batch: IBU-2024-003") or
   remove entirely if the batch is not relevant
   at browse time.

5. Price display: "ETB" prefix should be smaller
   than the number. The number is the decision data.
   Currency code is context. Treat them differently
   in weight and size.

6. Stock count needs relative context.
   "Stock: 3571" is meaningless without knowing
   whether that covers a typical order.
   Show a simple indicator instead:
   - Green dot: ample stock (>500 units)
   - Amber dot: limited stock (50-500 units)
   - Red dot: low stock (<50 units)
   The exact number can appear on the product detail page.

7. Price-per-unit comparison is missing.
   When the same drug is available in different
   pack sizes (Strip vs Tablet), buyers cannot
   compare unit economics at a glance.
   Show normalised price per unit below the
   pack price where UOM data is available.

### Typography hierarchy for the catalog

Product name: text-xl font-semibold (the anchor)
Category / strength: text-sm text-muted-foreground
Price: text-2xl font-bold tabular-nums (the hero)
Currency code: text-sm font-medium (subordinate to price)
Stock / expiry data: text-sm font-mono tabular-nums
Labels ("Exp:", "Batch:", "Stock:"): text-xs
  uppercase tracking-wide text-muted-foreground

### Color usage rules

Indigo (#4F46E5): primary actions only
  (Add to Cart button, active filters)
  Do not use on prices — prices should be
  near-black (#0F172A) for maximum readability.
  The current indigo prices look decorative,
  not data-forward.

Expiry colors: keep the current red/amber/green
  traffic light — this is correct and meaningful.

Status dots: use the traffic light palette
  for stock indicators (green/amber/red).

### What not to do

- Do not add decorative illustrations or icons
  to product cards. This is a procurement tool,
  not a consumer app.
- Do not add star ratings. EFDA registration
  number is the trust signal.
- Do not use card shadows for depth —
  use border and background-color contrast instead.
- Do not animate Add to Cart beyond a brief
  loading state. Speed signals trust.

---

## Pharmaceutical UX patterns (from code)

### Tabular numeric data

**Enforced by usage** (not a shared utility): `font-mono` and/or `tabular-nums` on prices, quantities, order IDs, totals.

Examples:

- `app/marketplace/page.tsx`, `app/marketplace/cart/page.tsx`, `app/marketplace/checkout/page.tsx`
- `app/marketplace/product/[slug]/page.tsx`
- `app/dashboard/page.tsx`, `procurement-orders-client.tsx`, `orders-client.tsx`
- `inventory-client.tsx`, `stock-client.tsx`, `procurement/approvals/page.tsx`

### Compliance / regulatory fields

- **No `compliance-field` class** in the repo.
- EFDA registration shown as plain labeled text, e.g. product page: *"EFDA Registration:"* + `font-mono tabular-nums` value (`app/marketplace/product/[slug]/page.tsx`).
- Item field source: ERPNext `custom_efda_registration_no`.

### Status badges

- **`components/ui/order-status-badge.tsx`**: Processing (amber), Confirmed (emerald), Cancelled (`destructive` variant) + short description line.
- **`components/ui/badge.tsx`**: CVA variants `default | secondary | destructive | outline | ghost | link`.
- Role badges in `components/layout/user-account-nav.tsx` (OWNER, DIRECTOR, PHARMACIST, Supplier, Buyer) with color-coded borders/backgrounds.

### Star ratings

- **Active marketplace routes:** supplier count only — no star-rating component.
- Legacy `app/(dashboard)/browse/page.tsx` (if present) used `⭐` with supplier count — route removed in favor of `/marketplace`.
- **Convention, not enforced:** no consumer star-rating UI.

---

## Component inventory

### `components/ui/` (Shadcn)

`avatar`, `badge`, `button`, `card`, `checkbox`, `dialog`, `drawer`, `dropdown-menu`, `input`, `input-otp`, `label`, `navigation-menu`, `order-status-badge`, `pagination`, `popover`, `radio-group`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `switch`, `table`, `tabs`, `textarea`, `tooltip`

### App-level `components/`

| Area | Components |
|------|------------|
| Shell / nav | `bamys-dashboard-shell.tsx`, `dashboard-shell.tsx`, `buyer-header.tsx`, `importer-header.tsx`, `importer-shell.tsx` |
| Marketplace | `marketplace/marketplace-top-nav.tsx`, `marketplace/nav-auth-button.tsx` |
| Account | `layout/user-account-nav.tsx`, `notifications/notification-bell.tsx` |
| Dashboard | `dashboard/supplier-dashboard.tsx`, `dashboard/kyc-status-banner.tsx` |
| Registration | `registration/registration-wizard.tsx`, `bank-select.tsx`, `account-list.tsx`, `add-account-form.tsx` |
| Providers | `providers/dashboard-store-provider.tsx` |

---

## Layout patterns

- **Marketplace:** `MarketplaceTopNav` sticky header; page background `#f9fafb` (`app/marketplace/layout.tsx`)
- **Dashboard:** fixed sidebar (`md:w-64`) + sticky header with `NotificationBell` + `UserAccountNav` (`components/bamys-dashboard-shell.tsx`)
- **Toasts:** Sonner, `richColors`, `top-center` (`app/layout.tsx`)

---

## Quality references (product direction)

**Not cited in source code** — stated UX targets:

| Reference | Intent |
|-----------|--------|
| **Faire.com** | Marketplace structure (browse, vendor offers, cart flow) |
| **Fullscript** | Compliance-oriented product/regulatory data presentation |

When adding UI, prefer: clean institutional tables, indigo primary, monospace tabular numbers for SKUs/prices/qty, explicit EFDA/regulatory labels over decorative chrome.

---

## Related docs

- **`CLAUDE.md`** — stack, env, business rules, commands
- **`.cursor/rules/ui-stack.mdc`** — approved UI stack (Tailwind + Shadcn + Lucide only)
