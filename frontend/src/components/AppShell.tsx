"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const links = [
  { href: "/dashboard", label: "Home" },
  { href: "/book", label: "Book visit" },
  { href: "/book?emergency=1", label: "Emergency" },
  { href: "/records", label: "Health records" },
  { href: "/profile", label: "Profile" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/provider")
  ) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--cc-bg)] text-[var(--cc-text)]">
      <header className="sticky top-0 z-50 border-b border-[var(--cc-border)] bg-[var(--cc-bg)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href="/dashboard" className="text-xl font-semibold tracking-tight text-[var(--cc-accent)]">
            CareConnect
          </Link>
          <nav className="flex flex-wrap items-center gap-2 sm:gap-3" aria-label="Main">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-4 py-3 text-base font-medium transition min-h-[48px] flex items-center ${
                  pathname === href
                    ? "bg-[var(--cc-accent-muted)] text-[var(--cc-accent)]"
                    : "text-[var(--cc-muted)] hover:bg-white/5 hover:text-[var(--cc-text)]"
                }`}
              >
                {label}
              </Link>
            ))}
            {user ? (
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-lg border border-[var(--cc-border)] px-4 py-3 text-base font-medium text-[var(--cc-muted)] min-h-[48px] hover:border-[var(--cc-accent)] hover:text-[var(--cc-text)]"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-[var(--cc-accent)] px-4 py-3 text-base font-semibold text-[var(--cc-bg-solid)] min-h-[48px] flex items-center"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
