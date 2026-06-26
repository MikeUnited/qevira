"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function decodeJwtPayloadForDisplay(
  token: string
): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const json = atob(b64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function InviteAcceptInner() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [previewEmail, setPreviewEmail] = useState("");
  const [previewRole, setPreviewRole] = useState("");
  const [previewOrg, setPreviewOrg] = useState("");

  useEffect(() => {
    if (!tokenFromUrl) {
      setTokenValid(false);
      return;
    }
    const decoded = decodeJwtPayloadForDisplay(tokenFromUrl);
    if (!decoded || decoded.type !== "team-invite") {
      setTokenValid(false);
      return;
    }
    setTokenValid(true);
    const em = decoded.email;
    const role = decoded.role;
    const org = decoded.organizationId;
    setPreviewEmail(typeof em === "string" ? em : "");
    setPreviewRole(typeof role === "string" ? role : "");
    setPreviewOrg(typeof org === "string" ? org : "");
  }, [tokenFromUrl]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenFromUrl) return;
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenFromUrl, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
      };
      if (!res.ok) {
        toast.error(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Request failed (${res.status})`
        );
        return;
      }
      setIsSuccess(true);
      const redirect =
        typeof data.redirect === "string" && data.redirect.startsWith("/")
          ? data.redirect
          : "/dashboard";
      window.location.href = redirect;
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (tokenValid === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  if (!tokenValid || !tokenFromUrl) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md items-center px-4">
        <p className="text-destructive text-center text-sm">
          Invalid invitation link.
        </p>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md items-center px-4">
        <p className="text-muted-foreground text-center text-sm">
          Redirecting to your dashboard…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Accept Your Invitation</CardTitle>
          <CardDescription>
            You are joining as <strong>{previewRole || "—"}</strong> at{" "}
            <strong>{previewOrg || "—"}</strong>
            {previewEmail ? (
              <>
                {" "}
                (<span className="font-mono text-xs">{previewEmail}</span>)
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Joining…
                </>
              ) : (
                "Join Organization"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      }
    >
      <InviteAcceptInner />
    </Suspense>
  );
}
