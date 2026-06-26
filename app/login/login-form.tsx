"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSafeCallbackUrl } from "@/lib/safe-callback-url";
import { userFacingFrappeMessage } from "@/lib/frappe-user-message";

type LoginErrorJson = {
  error?: unknown;
  retryAfter?: unknown;
  attemptsRemaining?: unknown;
  warning?: unknown;
};

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutMessage, setLockoutMessage] = useState<string | null>(null);
  const [attemptsWarning, setAttemptsWarning] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!lockoutUntil || lockoutUntil <= Date.now()) {
      setSecondsLeft(0);
      return;
    }
    const until = lockoutUntil;
    function tick() {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s <= 0) {
        setLockoutUntil(null);
        setLockoutMessage(null);
      }
    }
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const isLockedOut = lockoutUntil != null && Date.now() < lockoutUntil;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLockedOut) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      let data: LoginErrorJson | null = null;
      try {
        data = (await res.json()) as LoginErrorJson;
      } catch {
        data = null;
      }

      if (res.status === 429) {
        const fallback =
          "Account temporarily locked. Too many failed login attempts. Please try again in 15 minutes or use the Forgot Password link below.";
        const msg =
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : fallback;
        const retryRaw = data?.retryAfter;
        const retrySec =
          typeof retryRaw === "number" && Number.isFinite(retryRaw)
            ? retryRaw
            : 900;
        setLockoutMessage(msg);
        setLockoutUntil(Date.now() + retrySec * 1000);
        setAttemptsWarning(null);
        return;
      }

      if (!res.ok) {
        if (res.status === 401) {
          const errMsg =
            typeof data?.error === "string" && data.error.trim()
              ? data.error
              : "Invalid email or password.";
          toast.error(errMsg);
          const ar = data?.attemptsRemaining;
          if (typeof ar === "number" && Number.isFinite(ar) && ar <= 2) {
            setAttemptsWarning(ar);
          } else {
            setAttemptsWarning(null);
          }
          return;
        }
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(
          msg === `Request failed (${res.status})`
            ? "Invalid credentials"
            : msg
        );
        return;
      }

      setAttemptsWarning(null);
      setLockoutUntil(null);
      setLockoutMessage(null);

      router.refresh();

      const rawCallback = searchParams.get("callbackUrl");
      const nextPath = getSafeCallbackUrl(rawCallback) ?? "/dashboard";
      router.push(nextPath);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function onEmailChange(value: string) {
    setEmail(value);
    setAttemptsWarning(null);
  }

  return (
    <Card className="w-full max-w-md border shadow-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl tracking-tight">Sign in</CardTitle>
        <CardDescription>
          Enter your work email and password to access BAMYS.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {lockoutMessage && isLockedOut ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
            >
              <p className="font-medium whitespace-pre-wrap">{lockoutMessage}</p>
              {secondsLeft > 0 ? (
                <p className="mt-1.5 text-xs opacity-90">
                  You can try again in{" "}
                  {Math.floor(secondsLeft / 60) > 0
                    ? `${Math.floor(secondsLeft / 60)} min ${secondsLeft % 60} sec`
                    : `${secondsLeft} sec`}
                  .
                </p>
              ) : null}
            </div>
          ) : null}
          {attemptsWarning !== null &&
          attemptsWarning <= 2 &&
          attemptsWarning >= 0 ? (
            <div
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              {attemptsWarning === 0
                ? "Warning: No attempts remaining before temporary lockout."
                : attemptsWarning === 1
                  ? "Warning: 1 attempt remaining before temporary lockout."
                  : `Warning: ${attemptsWarning} attempts remaining before temporary lockout.`}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              required
              disabled={isSubmitting || isLockedOut}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting || isLockedOut}
            />
            <p className="text-right">
              <Link
                href="/forgot-password"
                className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot your password?
              </Link>
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 border-t pt-6">
          <Button
            type="submit"
            className="w-full gap-2"
            size="lg"
            disabled={isSubmitting || isLockedOut}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                Signing in…
              </>
            ) : isLockedOut ? (
              `Locked — try again in ${secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "…"}`
            ) : (
              "Sign in"
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Register here
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export function LoginForm() {
  return (
    <Suspense
      fallback={
        <Card className="w-full max-w-md border shadow-md">
          <CardHeader>
            <CardTitle className="text-2xl tracking-tight">Sign in</CardTitle>
            <CardDescription>Loading…</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      }
    >
      <LoginFormInner />
    </Suspense>
  );
}
