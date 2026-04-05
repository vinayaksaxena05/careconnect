"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

type Summary = {
  user: {
    open_emergencies: number;
    total_requests: number;
    completed_requests: number;
    pending_requests: number;
    avg_eta_minutes: number | null;
  };
  platform: {
    total_service_requests: number;
    verified_providers: number;
  };
  sla_note: string;
};

export default function DashboardPage() {
  const { user, loading, getAccessToken } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const token = getAccessToken();
    if (!token) return;
    apiFetch<Summary>("/api/analytics/summary", token)
      .then(setSummary)
      .catch((e: Error) => setErr(e.message));
  }, [user, getAccessToken]);

  if (loading || !user) {
    return (
      <div className="py-24 text-center text-[var(--cc-muted)] text-lg">Loading your dashboard…</div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Your home</h1>
        <p className="mt-2 max-w-2xl text-lg text-[var(--cc-muted)]">
          Large shortcuts help you act fast. Stats below update from your CareConnect API and Supabase
          data.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200">
          {err} — ensure the Node API is running and you are signed in.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/book?emergency=1"
          className="focus-ring flex min-h-[120px] flex-col justify-center rounded-2xl border-2 border-red-500/40 bg-red-500/5 p-8 text-left transition hover:border-red-400/60"
        >
          <span className="text-xl font-bold text-red-300">Emergency help</span>
          <span className="mt-1 text-[var(--cc-muted)]">
            Book an ambulance visit — service and provider pre-selected
          </span>
        </Link>
        <Link
          href="/book"
          className="focus-ring flex min-h-[120px] flex-col justify-center rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8 text-left transition hover:border-[var(--cc-accent)]"
        >
          <span className="text-xl font-bold text-[var(--cc-accent)]">Book a visit</span>
          <span className="mt-1 text-[var(--cc-muted)]">Ambulance, nurse, or teleconsult</span>
        </Link>
        <Link
          href="/records"
          className="focus-ring flex min-h-[120px] flex-col justify-center rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8 text-left transition hover:border-[var(--cc-accent)]"
        >
          <span className="text-xl font-bold">Health records</span>
          <span className="mt-1 text-[var(--cc-muted)]">Diagnoses and notes in one place</span>
        </Link>
        <Link
          href="/profile"
          className="focus-ring flex min-h-[120px] flex-col justify-center rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8 text-left opacity-90 transition hover:border-[var(--cc-accent)]"
        >
          <span className="text-xl font-bold">My profile</span>
          <span className="mt-1 text-[var(--cc-muted)]">Requests, records, visits, and reviews</span>
        </Link>
      </div>

      {summary && (
        <section className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8">
          <h2 className="text-xl font-semibold text-[var(--cc-accent)]">Your analytics</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active emergencies" value={String(summary.user.open_emergencies)} />
            <Stat label="Total requests" value={String(summary.user.total_requests)} />
            <Stat label="Completed" value={String(summary.user.completed_requests)} />
            <Stat
              label="Avg ETA (min)"
              value={summary.user.avg_eta_minutes != null ? String(summary.user.avg_eta_minutes) : "—"}
            />
          </div>
          <p className="mt-6 text-sm text-[var(--cc-muted)]">{summary.sla_note}</p>
          <p className="mt-2 text-sm text-[var(--cc-muted)]">
            Platform verified providers: {summary.platform.verified_providers ?? "—"} · Total
            requests (global): {summary.platform.total_service_requests ?? "—"}
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--cc-bg)] p-5">
      <p className="text-sm text-[var(--cc-muted)]">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
