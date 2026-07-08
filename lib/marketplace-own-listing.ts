import type { MarketplaceOffer } from "@/types/marketplace";

/**
 * True when the signed-in user is a supplier and this offer’s Item Price supplier
 * matches their ERPNext Supplier document (not the anonymized vendorAlias).
 */
export function isSupplierOwnListing(
  offer: Pick<MarketplaceOffer, "supplierId">,
  supplierDocName: string | null | undefined,
  supplierGroup: string | null | undefined
): boolean {
  if (!supplierGroup || !supplierDocName || !offer.supplierId) return false;
  return offer.supplierId === supplierDocName;
}

/** Cheapest offer index that is not the current user’s supplier listing; else 0. */
export function firstNonOwnOfferIndex(
  offers: MarketplaceOffer[],
  supplierDocName: string | null,
  supplierGroup: string | null
): number {
  let best = -1;
  let bestPrice = Infinity;
  for (let i = 0; i < offers.length; i++) {
    if (isSupplierOwnListing(offers[i], supplierDocName, supplierGroup)) {
      continue;
    }
    if (offers[i].price < bestPrice) {
      bestPrice = offers[i].price;
      best = i;
    }
  }
  if (best >= 0) return best;
  return 0;
}
