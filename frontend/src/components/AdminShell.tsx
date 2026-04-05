"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users & roles" },
  { href: "/admin/facilities", label: "Facilities" },
  { href: "/admin/catalog", label: "Service catalog" },
  { href: "/admin/data", label: "All tables" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, getAccessToken, signOut, user } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const verify = useCallback(async () => {
    const t = getAccessToken();
    if (!t) {
      setAllowed(false);
      return;
    }
    try {
      await apiFetch<{ role: string }>("/api/admin/me", t);
      setAllowed(true);
    } catch {
      setAllowed(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (pathname === "/admin/login") return;
    if (loading) return;
    if (!user) {
      queueMicrotask(() => setAllowed(false));
      return;
    }
    queueMicrotask(() => {
      void verify();
    });
  }, [pathname, loading, user, verify]);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (loading || allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0a09] text-zinc-400">
        Verifying administrator…
      </div>
    );
  }

  if (!user || allowed === false) {
    router.replace("/admin/login");
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0a09] text-zinc-400">
        Redirecting…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c0a09] text-zinc-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-amber-900/30 bg-stone-950/80 p-4 md:flex">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-500/90">
            CareConnect
          </p>
          <p className="mt-1 text-lg font-bold text-amber-400">Admin</p>
          <nav className="mt-8 flex flex-col gap-1" aria-label="Admin">
            {nav.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-3 py-3 text-sm font-medium ${
                  pathname === href
                    ? "bg-amber-500/15 text-amber-300"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-2 border-t border-amber-900/20 pt-4">
            <Link
              href="/dashboard"
              className="block rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-emerald-400"
            >
              ← Patient app
            </Link>
            <button
              type="button"
              onClick={() => signOut().then(() => router.replace("/admin/login"))}
              className="w-full rounded-lg border border-amber-900/40 px-3 py-2 text-left text-sm text-zinc-400 hover:border-amber-700"
            >
              Sign out
            </button>
          </div>
        </aside>
        <div className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-amber-900/30 bg-stone-950/50 px-2 py-3 md:hidden">
            <div className="flex items-center justify-between px-2">
              <span className="font-bold text-amber-400">Admin</span>
              <Link href="/dashboard" className="text-sm text-emerald-300">
                Patient app
              </Link>
            </div>
            <nav className="mt-2 flex gap-1 overflow-x-auto px-1 pb-1 text-xs" aria-label="Admin mobile">
              {nav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`shrink-0 rounded-lg px-3 py-2 font-medium ${
                    pathname === href ? "bg-amber-500/20 text-amber-200" : "text-zinc-500"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1 overflow-auto px-4 py-8 md:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
