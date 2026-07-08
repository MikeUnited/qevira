"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { handleUnauthorized } from "@/lib/handle-unauthorized";

export function useAuthFetch() {
  const pathname = usePathname();

  return React.useCallback(
    async function authFetch(
      url: string,
      options?: RequestInit
    ): Promise<Response> {
      const res = await fetch(url, {
        ...options,
        credentials: options?.credentials ?? "include",
      });
      if (res.status === 401) {
        const currentPath =
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : pathname;
        handleUnauthorized(currentPath);
        return res;
      }
      return res;
    },
    [pathname]
  );
}
