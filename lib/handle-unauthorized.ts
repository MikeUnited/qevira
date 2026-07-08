export function handleUnauthorized(currentPath: string) {
  const callbackUrl = encodeURIComponent(currentPath);
  window.location.href = `/login?callbackUrl=${callbackUrl}`;
}
