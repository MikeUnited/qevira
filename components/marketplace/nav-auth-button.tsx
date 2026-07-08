"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

export function NavAuthButton() {
  const pathname = usePathname();
  const [status, setStatus] = React.useState<"loading" | "in" | "out">(
    "loading"
  );

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
        };
        if (!cancelled) {
          setStatus(json.authenticated === true ? "in" : "out");
        }
      } catch {
        if (!cancelled) setStatus("out");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <Button type="button" variant="outline" size="sm" disabled className="min-w-[8rem]">
        …
      </Button>
    );
  }

  if (status === "in") {
    return (
      <Button type="button" variant="default" size="sm" asChild>
        <Link href="/dashboard">Go to Dashboard</Link>
      </Button>
    );
  }

  const loginHref = `/login?callbackUrl=${encodeURIComponent(pathname || "/marketplace")}`;

  return (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href={loginHref}>Login</Link>
    </Button>
  );
}
