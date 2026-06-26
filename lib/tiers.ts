export const TIER_MAP: Record<string, number> = {
  Manufacturer: 0,
  Importer: 1,
  Wholesaler: 2,
};

export const ALLOWED_UPSTREAM: Record<string, string[]> = {
  Importer: ["Manufacturer"],
  Wholesaler: ["Importer"],
  // Customers (Tier 3) see all — handled separately
};

export function getAllowedSupplierGroups(
  userSupplierGroup: string | null,
  isCustomer: boolean
): string[] | "ALL" {
  // Pure buyers (no supplier group) see everything
  if (isCustomer && !userSupplierGroup) return "ALL";

  // Suppliers see their upstream tier only
  if (
    userSupplierGroup &&
    ALLOWED_UPSTREAM[userSupplierGroup]
  ) {
    return ALLOWED_UPSTREAM[userSupplierGroup];
  }

  // Manufacturers have no upstream —
  // they cannot buy from the marketplace
  // Return empty array to show nothing
  if (userSupplierGroup === "Manufacturer") return [];

  // Unknown group — default to all (safe fallback)
  return "ALL";
}

export function canViewSupplier(
  viewerSupplierGroup: string | null,
  viewerIsCustomer: boolean,
  targetSupplierGroup: string,
  targetSupplierId: string,
  viewerSupplierId: string | null
): boolean {
  // Always allow viewing own listings
  if (viewerSupplierId && viewerSupplierId === targetSupplierId) return true;

  const allowed = getAllowedSupplierGroups(
    viewerSupplierGroup,
    viewerIsCustomer
  );

  if (allowed === "ALL") return true;
  return allowed.includes(targetSupplierGroup);
}
