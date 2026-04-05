"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

type ProviderRow = {
  provider_id: string;
  name: string;
  specialization: string;
  verified: boolean;
  license_number: string;
};

type AssignedRequest = {
  request_id: string;
  request_time: string;
  status: string;
  location: string;
  service_types: { service_name: string } | null;
  user_id: string;
};

export default function ProviderDashboardPage() {
  const { user, loading, getAccessToken } = useAuth();
  const router = useRouter();
  const [me, setMe] = useState<ProviderRow | null>(null);
  const [requests, setRequests] = useState<AssignedRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const t = getAccessToken();
    if (!t) return;
    Promise.all([
      apiFetch<ProviderRow>("/api/me/provider", t),
      apiFetch<AssignedRequest[]>("/api/me/provider/requests", t),
    ])
      .then(([p, r]) => {
        setMe(p);
        setRequests(r);
      })
      .catch((e: Error) => setErr(e.message));
  }, [user, getAccessToken]);

  if (loading || !user) {
    return <div className="text-[var(--cc-muted)]">Loading…</div>;
  }

  if (err) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-100">
        <p>{err}</p>
        <p className="mt-2 text-sm text-[var(--cc-muted)]">
          If you are a patient, open the{" "}
          <a href="/dashboard" className="text-[var(--cc-accent)] underline">
            main app
          </a>
          . Providers can{" "}
          <a href="/provider/register" className="text-[var(--cc-accent)] underline">
            register here
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-bold">Provider dashboard</h1>
        {me && (
          <p className="mt-2 text-[var(--cc-muted)]">
            {me.name} · {me.specialization} · {me.verified ? "Verified" : "Pending verification"}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-xl font-semibold">Assigned visits</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {requests.length === 0 && (
            <li className="text-[var(--cc-muted)]">No assignments yet.</li>
          )}
          {requests.map((r) => (
            <li
              key={r.request_id}
              className="rounded-xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-4"
            >
              <p className="font-medium">{r.service_types?.service_name ?? "Service"}</p>
              <p className="text-sm text-[var(--cc-muted)]">
                {new Date(r.request_time).toLocaleString()} · {r.status}
              </p>
              <p className="mt-2 text-sm">{r.location}</p>
              <p className="mt-1 text-xs text-[var(--cc-muted)]">Patient user_id: {r.user_id}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
