import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--cc-bg)] text-[var(--cc-text)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-16 md:py-24">
        <header className="flex flex-col gap-6 text-center md:text-left">
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--cc-accent)]">
            CareConnect
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl lg:text-6xl">
            Healthcare on demand, built for calm under pressure.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-[var(--cc-muted)] md:text-xl">
            Book ambulances and clinicians, track response in real time, and keep
            medical history at hand—especially when screens feel overwhelming.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-center md:justify-start">
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[var(--cc-accent)] px-8 text-lg font-semibold text-zinc-950"
            >
              Sign in to continue
            </Link>
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-[52px] items-center justify-center rounded-xl border border-[var(--cc-border)] px-8 text-lg font-medium text-[var(--cc-text)] hover:bg-[var(--cc-surface)]"
            >
              Create account
            </Link>
            <Link
              href="/login?next=/book%3Femergency%3D1"
              className="focus-ring inline-flex min-h-[52px] items-center justify-center rounded-xl border-2 border-red-500/40 bg-red-500/10 px-8 text-lg font-semibold text-red-200 hover:border-red-400/60"
            >
              Emergency — book ambulance
            </Link>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Instant booking",
              body: "Large buttons and plain language so booking stays fast in emergencies.",
            },
            {
              title: "Live tracking",
              body: "Map-based ETA updates for ambulance and responder dispatch.",
            },
            {
              title: "Your records",
              body: "Structured medical history aligned with a normalized, privacy-aware database.",
            },
          ].map((c) => (
            <article
              key={c.title}
              className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8 shadow-lg shadow-black/20"
            >
              <h2 className="text-xl font-semibold text-[var(--cc-accent)]">{c.title}</h2>
              <p className="mt-3 text-[var(--cc-muted)] leading-relaxed">{c.body}</p>
            </article>
          ))}
        </section>

        <footer className="border-t border-[var(--cc-border)] pt-10 text-center text-sm text-[var(--cc-muted)]">
          CareConnect · Row-level security on Supabase · Next.js, Node, and PostgreSQL
          <span className="mt-3 block">
            <Link href="/admin/login" className="text-[var(--cc-accent)]/80 hover:underline">
              Administrator login
            </Link>
          </span>
        </footer>
      </div>
    </div>
  );
}
