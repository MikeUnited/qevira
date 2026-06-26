/** URL-safe slug for `/marketplace/product/[slug]` from generic item display name. */
export function slugifyProductName(genericName: string): string {
  return genericName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
