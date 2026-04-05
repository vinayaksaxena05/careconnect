import Link from "next/link";

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--cc-bg)] text-[var(--cc-text)]">
      <header className="border-b border-[var(--cc-border)] bg-[var(--cc-surface)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href="/provider/dashboard" className="text-lg font-bold text-[var(--cc-accent)]">
            CareConnect · Provider
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm font-medium">
            <Link href="/provider/register" className="text-[var(--cc-muted)] hover:text-[var(--cc-text)]">
              Register
            </Link>
            <Link href="/login" className="text-[var(--cc-muted)] hover:text-[var(--cc-text)]">
              Sign in
            </Link>
            <Link href="/" className="text-[var(--cc-muted)] hover:text-[var(--cc-text)]">
              Home
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">{children}</main>
    </div>
  );
}
