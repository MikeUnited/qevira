/** Client-side shape for `/api/user/profile` when only groups are needed. */
export type DashboardUserProfile = {
  customerGroup: string | null;
  supplierGroup: string | null;
};

export type VendorCatalogRow = {
  itemCode: string;
  itemName: string;
  group: string;
  efda: string;
  price: number;
  stock: number;
};

/** Aggregated marketplace row from catalog APIs (no per-vendor offers). */
export type MarketplaceProductSummary = {
  genericName: string;
  itemGroup: string;
  /** Some catalog payloads use `group` instead of `itemGroup`. */
  group?: string;
  uom: string;
  efda: string;
  /** Plain text from Item.description when present. */
  description?: string | null;
  lowestPrice: number;
  totalStock: number;
  supplierCount: number;
};

export type MarketplaceOffer = {
  vendorAlias: string;
  /** ERPNext Supplier document name (Item Price supplier); used for self-listing checks. */
  supplierId?: string;
  price: number;
  stock: number;
  uom: string;
  offerToken: string;
  /** YYYY-MM-DD from earliest Batch, or null. */
  batchExpiry: string | null;
  /** Batch reference from ERPNext Batch (not item code). */
  batchLabel?: string | null;
};

export type MarketplaceProduct = MarketplaceProductSummary & {
  offers: MarketplaceOffer[];
};
