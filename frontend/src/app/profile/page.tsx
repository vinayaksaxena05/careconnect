"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

type Profile = {
  user_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  role: string;
};

type MedicalRecord = {
  record_id: string;
  diagnosis: string;
  notes: string | null;
  record_date: string;
};

type RequestRow = {
  request_id: string;
  request_time: string;
  status: string;
  location: string;
  eta_minutes: number | null;
  healthcare_providers: { name: string } | null;
  service_types: { service_name: string; base_price: number } | null;
  payments: { payment_id: string; status: string } | null | unknown[];
  rating_feedback: { feedback_id: string; rating: number; comments: string | null } | null | unknown[];
};

function firstOrNull<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

export default function ProfilePage() {
  const { user, loading, getAccessToken } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const t = getAccessToken();
    if (!t) return;
    Promise.all([
      apiFetch<Profile>("/api/me/profile", t),
      apiFetch<MedicalRecord[]>("/api/me/medical-records", t),
      apiFetch<RequestRow[]>("/api/me/requests", t),
    ])
      .then(([p, rec, req]) => {
        setProfile(p);
        setRecords(rec);
        setRequests(req);
      })
      .catch((e: Error) => setErr(e.message));
  }, [user, getAccessToken]);

  if (loading || !user) {
    return <div className="py-24 text-center text-[var(--cc-muted)]">Loading…</div>;
  }

  const pastVisits = [...requests].sort(
    (a, b) => new Date(b.request_time).getTime() - new Date(a.request_time).getTime(),
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold md:text-4xl">Your profile</h1>
          <p className="mt-2 text-lg text-[var(--cc-muted)]">
            Full history of requests, health records, and feedback you have left.
          </p>
        </div>
        <Link
          href="/book"
          className="focus-ring rounded-xl bg-[var(--cc-accent)] px-5 py-3 font-semibold text-zinc-950"
        >
          Book a visit
        </Link>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200">{err}</p>
      )}

      {profile && (
        <section className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8">
          <h2 className="text-xl font-semibold text-[var(--cc-accent)]">Account</h2>
          <dl className="mt-4 grid gap-3 text-[var(--cc-text)] sm:grid-cols-2">
            <div>
              <dt className="text-sm text-[var(--cc-muted)]">Name</dt>
              <dd className="font-medium">{profile.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--cc-muted)]">Phone</dt>
              <dd>{profile.phone ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-[var(--cc-muted)]">Address</dt>
              <dd>{profile.address ?? "—"}</dd>
            </div>
          </dl>
        </section>
      )}

      <section>
        <h2 className="text-2xl font-bold">Visits & requests</h2>
        <p className="mt-1 text-sm text-[var(--cc-muted)]">Including completed and in progress.</p>
        <ul className="mt-6 flex flex-col gap-4">
          {pastVisits.length === 0 && (
            <li className="text-[var(--cc-muted)]">No visits yet.</li>
          )}
          {pastVisits.map((r) => {
            const pay = firstOrNull(r.payments);
            const fb = firstOrNull(r.rating_feedback);
            return (
              <li
                key={r.request_id}
                className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-6"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-lg font-semibold">
                    {r.service_types?.service_name ?? "Service"}
                  </p>
                  <span className="text-sm text-[var(--cc-muted)]">
                    {new Date(r.request_time).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-[var(--cc-muted)]">
                  {r.healthcare_providers?.name ?? "Provider"} · {r.status}
                  {pay ? " · Paid" : ""}
                </p>
                <p className="mt-2 text-sm text-[var(--cc-muted)]">{r.location}</p>
                {fb != null && (
                  <p className="mt-3 text-sm text-emerald-300">
                    Your review: {fb.rating}★ — {fb.comments ?? "—"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-bold">Health records</h2>
        <p className="mt-1 text-sm text-[var(--cc-muted)]">
          Past diagnoses and clinical notes on file.{" "}
          <Link href="/records" className="text-[var(--cc-accent)] hover:underline">
            Open records tools
          </Link>
        </p>
        <ul className="mt-6 flex flex-col gap-4">
          {records.length === 0 && (
            <li className="text-[var(--cc-muted)]">No records stored yet.</li>
          )}
          {records.map((rec) => (
            <li
              key={rec.record_id}
              className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-6"
            >
              <p className="font-semibold">{rec.diagnosis}</p>
              <p className="mt-1 text-sm text-[var(--cc-muted)]">
                {new Date(rec.record_date).toLocaleDateString()}
              </p>
              {rec.notes && (
                <p className="mt-2 text-sm leading-relaxed text-[var(--cc-text)]">{rec.notes}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
