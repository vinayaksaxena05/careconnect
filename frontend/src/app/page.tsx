import Link from "next/link";

export default function HomePage() {
  const features = [
    {
      title: "Fast, stress-free booking",
      body: "Large touch targets and clear labels keep booking simple for patients and families.",
    },
    {
      title: "Live dispatch visibility",
      body: "Follow ambulance movement with reliable ETA updates while staying informed in real time.",
    },
    {
      title: "Secure care history",
      body: "Medical records and request history stay organized with privacy-aware backend policies.",
    },
    {
      title: "Trusted provider network",
      body: "Browse verified providers, compare services quickly, and book with more confidence.",
    },
    {
      title: "Emergency-first flows",
      body: "Priority actions are always visible so urgent care can be requested in seconds.",
    },
    {
      title: "Built for every device",
      body: "A responsive layout keeps the experience smooth from small phones to large desktop screens.",
    },
  ];

  const steps = [
    {
      title: "Choose care type",
      body: "Select standard consultation, specialist support, or emergency ambulance service.",
    },
    {
      title: "Share location and details",
      body: "Add your address, optional notes, and request preferences in one simple flow.",
    },
    {
      title: "Track and complete care",
      body: "Monitor progress, receive support, then finish payment and feedback when care is complete.",
    },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#111827_0%,_#0b1020_45%,_#09090b_100%)] text-[var(--cc-text)]">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:px-8 lg:pt-20">
        <header className="relative overflow-hidden rounded-3xl border border-[var(--cc-border)]/80 bg-[linear-gradient(160deg,rgba(24,24,27,.88),rgba(17,24,39,.82))] px-6 py-10 shadow-[0_30px_120px_rgba(0,0,0,.35)] sm:px-10 sm:py-14">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--cc-accent)]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cc-accent)] sm:text-sm">
            CareConnect
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Modern care booking that feels calm, clear, and dependable.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--cc-muted)] sm:text-lg">
            From urgent ambulance requests to routine appointments, CareConnect
            helps people access healthcare quickly with live tracking, secure
            records, and a clean experience built for high-stress moments.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[var(--cc-accent)] px-6 text-base font-semibold text-zinc-950 transition hover:-translate-y-0.5 hover:bg-emerald-300"
            >
              Sign in to continue
            </Link>
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-[52px] items-center justify-center rounded-xl border border-[var(--cc-border)] bg-white/[0.02] px-6 text-base font-medium text-[var(--cc-text)] transition hover:-translate-y-0.5 hover:bg-white/[0.06]"
            >
              Create account
            </Link>
            <Link
              href="/login?next=/book%3Femergency%3D1"
              className="focus-ring inline-flex min-h-[52px] items-center justify-center rounded-xl border border-red-400/45 bg-red-500/10 px-6 text-base font-semibold text-red-100 transition hover:-translate-y-0.5 hover:border-red-300/70 hover:bg-red-500/15"
            >
              Emergency booking
            </Link>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <article
              className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)]/80 p-5"
            >
              <p className="text-sm text-[var(--cc-muted)]">Avg response coordination</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--cc-accent)]">Under 3 mins</p>
            </article>
            <article className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)]/80 p-5">
              <p className="text-sm text-[var(--cc-muted)]">Provider visibility</p>
              <p className="mt-2 text-2xl font-semibold">Verified network</p>
            </article>
            <article className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)]/80 p-5">
              <p className="text-sm text-[var(--cc-muted)]">Data confidence</p>
              <p className="mt-2 text-2xl font-semibold">Secure by design</p>
            </article>
          </div>
        </header>

        <section className="mt-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cc-accent)]">
              Features
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything needed for modern healthcare coordination
            </h2>
            <p className="mt-4 text-base leading-8 text-[var(--cc-muted)] sm:text-lg">
              Designed to reduce friction across booking, dispatch, and follow-up so
              patients and teams can focus on care, not complexity.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="rounded-2xl border border-[var(--cc-border)] bg-[linear-gradient(160deg,rgba(24,24,27,.94),rgba(20,24,33,.9))] p-6 transition hover:border-[var(--cc-accent)]/40 hover:shadow-[0_15px_40px_rgba(16,185,129,.09)]"
              >
                <h3 className="text-xl font-semibold">{feature.title}</h3>
                <p className="mt-3 leading-7 text-[var(--cc-muted)]">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-24 rounded-3xl border border-[var(--cc-border)] bg-[var(--cc-surface)]/70 p-6 sm:p-10">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cc-accent)]">
              How It Works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Three steps from request to completed care
            </h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
              <article
                key={step.title}
                className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-bg)]/70 p-6"
              >
                <p className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cc-accent-muted)] text-sm font-semibold text-[var(--cc-accent)]">
                  {i + 1}
                </p>
                <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                <p className="mt-3 leading-7 text-[var(--cc-muted)]">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-24 rounded-3xl border border-[var(--cc-border)] bg-[linear-gradient(140deg,rgba(52,211,153,.16),rgba(34,211,238,.06),rgba(24,24,27,.9))] px-6 py-12 sm:px-10 sm:py-14">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Ready to start
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Bring calm and clarity to every care request
            </h2>
            <p className="mt-4 text-base leading-8 text-zinc-200/85 sm:text-lg">
              Sign in to continue, create a new account, or jump directly into the
              emergency booking flow when time matters most.
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-[50px] items-center justify-center rounded-xl bg-[var(--cc-accent)] px-6 text-base font-semibold text-zinc-950 transition hover:-translate-y-0.5"
            >
              Open CareConnect
            </Link>
            <Link
              href="/login?next=/book%3Femergency%3D1"
              className="focus-ring inline-flex min-h-[50px] items-center justify-center rounded-xl border border-red-300/55 bg-red-500/10 px-6 text-base font-semibold text-red-100 transition hover:bg-red-500/15"
            >
              Request emergency support
            </Link>
          </div>
        </section>

        <footer className="mt-20 border-t border-[var(--cc-border)] pt-8 text-sm text-[var(--cc-muted)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p>
              CareConnect · Built with Next.js, Node, Supabase, and PostgreSQL
            </p>
            <Link
              href="/admin/login"
              className="focus-ring w-fit text-[var(--cc-accent)]/90 transition hover:text-[var(--cc-accent)] hover:underline"
            >
              Administrator login
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
