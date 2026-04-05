"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function LoginInner() {
  const { signIn, signUp, user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const redirectAfterSession = useCallback(async () => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession();
    const token = session?.access_token;
    let dest = nextPath && nextPath.startsWith("/") ? nextPath : "/dashboard";
    if (token) {
      try {
        const prof = await apiFetch<{ role: string }>("/api/me/profile", token);
        if (prof.role === "provider") dest = "/provider/dashboard";
      } catch {
        /* profile missing — stay on default */
      }
    }
    router.replace(dest);
  }, [nextPath, router]);

  useEffect(() => {
    if (!loading && user) {
      void redirectAfterSession();
    }
  }, [loading, user, redirectAfterSession]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--cc-muted)]">
        Loading…
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--cc-muted)]">
        Redirecting…
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setPending(true);
    try {
      if (mode === "signin") {
        const { error } = await signIn(email, password);
        if (error) setMessage(error);
        else await redirectAfterSession();
      } else {
        if (!fullName.trim()) {
          setMessage("Please enter your full name.");
          setPending(false);
          return;
        }
        const { error } = await signUp(email, password, fullName.trim());
        if (error) setMessage(error);
        else {
          setMessage("Check your email to confirm, then sign in.");
          setMode("signin");
        }
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--cc-bg)] px-4 py-16">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8 shadow-xl">
        <h1 className="text-center text-2xl font-bold text-[var(--cc-text)]">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-2 text-center text-[var(--cc-muted)]">
          CareConnect uses Supabase Auth — your data stays encrypted at rest.
        </p>

        <div className="mt-8 flex rounded-xl bg-[var(--cc-surface-2)] p-1">
          <button
            type="button"
            className={`flex-1 rounded-lg py-3 text-base font-semibold min-h-[48px] ${
              mode === "signin" ? "bg-[var(--cc-accent)] text-zinc-950" : "text-[var(--cc-muted)]"
            }`}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg py-3 text-base font-semibold min-h-[48px] ${
              mode === "signup" ? "bg-[var(--cc-accent)] text-zinc-950" : "text-[var(--cc-muted)]"
            }`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
          {mode === "signup" && (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[var(--cc-muted)]">Full name</span>
              <input
                className="focus-ring rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 py-3 text-lg text-[var(--cc-text)]"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                placeholder="e.g. Vinayak Saxena"
              />
            </label>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--cc-muted)]">Email</span>
            <input
              type="email"
              required
              className="focus-ring rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 py-3 text-lg text-[var(--cc-text)]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--cc-muted)]">Password</span>
            <input
              type="password"
              required
              className="focus-ring rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 py-3 text-lg text-[var(--cc-text)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </label>
          {message && (
            <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-200" role="alert">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="focus-ring mt-2 min-h-[52px] rounded-xl bg-[var(--cc-accent)] text-lg font-semibold text-zinc-950 disabled:opacity-60"
          >
            {pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--cc-muted)]">
          Healthcare provider?{" "}
          <Link href="/provider/register" className="text-[var(--cc-accent)] hover:underline">
            Register as provider
          </Link>
        </p>

        <p className="mt-4 text-center text-[var(--cc-muted)]">
          <Link href="/" className="text-[var(--cc-accent)] hover:underline">
            Back to overview
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-[var(--cc-muted)]">
          Loading…
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
