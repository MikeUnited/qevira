import type {
  MarketplaceProductSummary,
  VendorCatalogRow,
} from "@/types/marketplace";

const PAGE_SIZE = 100;

function httpErrorMessage(json: unknown, status: number): string {
  if (
    json &&
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof (json as { error?: string }).error === "string"
  ) {
    return (json as { error: string }).error;
  }
  return `Request failed (${status})`;
}

function parseMarketplacePayload(data: unknown): {
  products: MarketplaceProductSummary[];
  totalPages: number;
} {
  if (Array.isArray(data)) {
    return { products: data as MarketplaceProductSummary[], totalPages: 1 };
  }
  if (data && typeof data === "object" && "products" in data) {
    const products = (data as { products?: unknown }).products;
    const pagination = (data as { pagination?: { totalPages?: number } })
      .pagination;
    return {
      products: Array.isArray(products)
        ? (products as MarketplaceProductSummary[])
        : [],
      totalPages: Math.max(1, pagination?.totalPages ?? 1),
    };
  }
  return { products: [], totalPages: 1 };
}

function parseVendorPayload(data: unknown): {
  items: VendorCatalogRow[];
  totalPages: number;
} {
  if (Array.isArray(data)) {
    return { items: data as VendorCatalogRow[], totalPages: 1 };
  }
  if (data && typeof data === "object" && "items" in data) {
    const items = (data as { items?: unknown }).items;
    const pagination = (data as { pagination?: { totalPages?: number } })
      .pagination;
    return {
      items: Array.isArray(items) ? (items as VendorCatalogRow[]) : [],
      totalPages: Math.max(1, pagination?.totalPages ?? 1),
    };
  }
  return { items: [], totalPages: 1 };
}

/** Loads every page from `/api/marketplace/catalog` (pageSize capped at 100 server-side). */
export async function fetchAllMarketplaceProducts(
  init?: RequestInit
): Promise<MarketplaceProductSummary[]> {
  const all: MarketplaceProductSummary[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const res = await fetch(
      `/api/marketplace/catalog?page=${page}&pageSize=${PAGE_SIZE}`,
      init
    );
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(httpErrorMessage(data, res.status));
    }
    const { products, totalPages: tp } = parseMarketplacePayload(data);
    all.push(...products);
    totalPages = tp;
    page++;
  }
  return all;
}

/** Loads every page from `/api/vendor/catalog/list`. */
export async function fetchAllVendorCatalogItems(
  init?: RequestInit
): Promise<VendorCatalogRow[]> {
  const all: VendorCatalogRow[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const res = await fetch(
      `/api/vendor/catalog/list?page=${page}&pageSize=${PAGE_SIZE}`,
      init
    );
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(httpErrorMessage(data, res.status));
    }
    const { items, totalPages: tp } = parseVendorPayload(data);
    all.push(...items);
    totalPages = tp;
    page++;
  }
  return all;
}
