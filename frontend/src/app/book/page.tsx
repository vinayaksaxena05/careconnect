"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

const RECENT_MS = 2 * 60 * 60 * 1000;

function isWithinLastTwoHours(iso: string) {
  return Date.now() - new Date(iso).getTime() < RECENT_MS;
}

type Provider = {
  provider_id: string;
  name: string;
  specialization: string;
  verified: boolean;
  avg_rating: number | null;
  review_count: number;
};

type Service = {
  service_id: string;
  service_name: string;
  base_price: number;
  duration_minutes: number;
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
  rating_feedback: { feedback_id: string } | null | unknown[];
};

type EmergencyRow = {
  emergency_id: string;
  created_at: string;
  severity: string;
  location: string | null;
  response_eta_minutes: number | null;
  status: string;
};

function firstOrNull<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

function normalizeStatus(s: string) {
  return s.trim().toLowerCase();
}

function canCancelVisit(r: RequestRow, payRow: ReturnType<typeof firstOrNull>) {
  if (payRow != null) return false;
  const st = normalizeStatus(r.status);
  return st === "requested" || st === "in_progress" || st === "confirmed";
}

function pickAmbulanceService(services: Service[]) {
  const primary = services.find(
    (s) => /ambulance/i.test(s.service_name) && !/first responder|paramedic/i.test(s.service_name),
  );
  if (primary) return primary;
  return services.find((s) => /ambulance/i.test(s.service_name)) ?? null;
}

function pickAmbulanceProvider(providers: Provider[]) {
  const byName = providers.find((p) =>
    /apollo|rapid|paramedic|ambulance|citycare/i.test(p.name),
  );
  if (byName) return byName;
  const bySpec = providers.find((p) =>
    /emergency|paramedic|critical care|trauma/i.test(p.specialization),
  );
  if (bySpec) return bySpec;
  return providers.find((p) => p.verified) ?? providers[0] ?? null;
}

function BookPageInner() {
  const { user, loading, getAccessToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const emergencyFlow = searchParams.get("emergency") === "1";

  const [providers, setProviders] = useState<Provider[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRow[]>([]);
  const [providerId, setProviderId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [location, setLocation] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const t = getAccessToken();
    if (!t) return;
    Promise.all([
      apiFetch<Provider[]>("/api/providers", t),
      apiFetch<Service[]>("/api/services", t),
      apiFetch<RequestRow[]>("/api/me/requests", t),
      apiFetch<EmergencyRow[]>("/api/me/emergencies", t),
    ])
      .then(([p, s, r, e]) => {
        setProviders(p);
        setServices(s);
        setRequests(r);
        setEmergencies(e);
        if (s[0] && !emergencyFlow) setServiceId(s[0].service_id);
        if (!emergencyFlow) {
          const verified = p.find((x) => x.verified);
          if (verified) setProviderId(verified.provider_id);
        }
      })
      .catch((err: Error) => setMsg(err.message));
  }, [user, getAccessToken, emergencyFlow]);

  useEffect(() => {
    if (services.length === 0 || providers.length === 0) return;
    if (!emergencyFlow) return;
    const ambSvc = pickAmbulanceService(services);
    if (ambSvc) setServiceId(ambSvc.service_id);
    const ambProv = pickAmbulanceProvider(providers);
    if (ambProv) setProviderId(ambProv.provider_id);
  }, [emergencyFlow, services, providers]);

  function useGps() {
    if (!navigator.geolocation) {
      setMsg("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLocation(
          `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (GPS)`,
        );
      },
      () => setMsg("Could not read your location — enter an address instead."),
    );
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const t = getAccessToken();
    if (!t || !serviceId || !location.trim()) {
      setMsg("Choose a service and describe your location.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch<unknown>("/api/requests", t, {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId || null,
          service_id: serviceId,
          location: location.trim(),
          location_lat: lat,
          location_lng: lng,
        }),
      });
      setMsg("Booking confirmed. Open tracking from your list below when unpaid.");
      const [rows, em] = await Promise.all([
        apiFetch<RequestRow[]>("/api/me/requests", t),
        apiFetch<EmergencyRow[]>("/api/me/emergencies", t),
      ]);
      setRequests(rows);
      setEmergencies(em);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pay(requestId: string, amount: number) {
    const t = getAccessToken();
    if (!t) return;
    setBusy(true);
    try {
      await apiFetch("/api/payments", t, {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId,
          amount,
          method: "card",
        }),
      });
      setRequests(await apiFetch("/api/me/requests", t));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelVisit(requestId: string) {
    if (
      !window.confirm(
        "Cancel this visit? It will disappear from your list. You can book again anytime.",
      )
    ) {
      return;
    }
    const t = getAccessToken();
    if (!t) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/requests/${requestId}/status`, t, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      });
      setRequests((prev) => prev.filter((x) => x.request_id !== requestId));
      setMsg("Visit cancelled.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback(requestId: string, rating: number) {
    const t = getAccessToken();
    if (!t) return;
    setBusy(true);
    try {
      await apiFetch("/api/feedback", t, {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId,
          rating,
          comments: "Thank you — CareConnect",
        }),
      });
      setRequests(await apiFetch("/api/me/requests", t));
      const p = await apiFetch<Provider[]>("/api/providers", t);
      setProviders(p);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="py-24 text-center text-[var(--cc-muted)]">Loading…</div>;
  }

  const recentEmergencies = emergencies.filter((x) => isWithinLastTwoHours(x.created_at));
  const recentRequests = requests.filter(
    (r) =>
      isWithinLastTwoHours(r.request_time) && normalizeStatus(r.status) !== "cancelled",
  );

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="text-3xl font-bold md:text-4xl">Book a service</h1>
        <p className="mt-2 text-lg text-[var(--cc-muted)]">
          Choose a verified provider and service type from the normalized catalogue.
        </p>
        {emergencyFlow && (
          <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-100">
            Emergency booking: ambulance service and a response-capable provider are pre-selected.
            Add your location and confirm — or change provider if you prefer.
          </p>
        )}
      </div>

      {msg && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-emerald-200" role="status">
          {msg}
        </p>
      )}

      <form
        onSubmit={submitBooking}
        className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8"
      >
        <div className="grid gap-6 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--cc-muted)]">Service</span>
            <select
              className="focus-ring min-h-[52px] rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 text-lg"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {services.map((s) => (
                <option key={s.service_id} value={s.service_id}>
                  {s.service_name} — ₹{Number(s.base_price).toFixed(0)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--cc-muted)]">Provider (optional)</span>
            <select
              className="focus-ring min-h-[52px] rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 text-lg"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">Let CareConnect assign</option>
              {providers.map((p) => (
                <option key={p.provider_id} value={p.provider_id}>
                  {p.name}
                  {p.avg_rating != null ? ` ★ ${p.avg_rating}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-6 flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--cc-muted)]">
            Location — address or landmark
          </span>
          <textarea
            className="focus-ring min-h-[120px] rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 py-3 text-lg"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="House number, street, area, city"
          />
        </label>
        <button
          type="button"
          onClick={useGps}
          className="focus-ring mt-4 rounded-xl border border-[var(--cc-border)] px-5 py-3 text-base font-medium hover:border-[var(--cc-accent)]"
        >
          Use my GPS instead
        </button>
        <button
          type="submit"
          disabled={busy}
          className="focus-ring mt-6 w-full min-h-[56px] rounded-xl bg-[var(--cc-accent)] text-lg font-semibold text-zinc-950 disabled:opacity-60"
        >
          {busy ? "Sending…" : "Request service"}
        </button>
      </form>

      {recentEmergencies.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold">Recent emergency responses</h2>
          <p className="mt-1 text-sm text-[var(--cc-muted)]">
            Shown for two hours after dispatch; older activity stays in your full profile.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {recentEmergencies.map((em) => (
              <li
                key={em.emergency_id}
                className="rounded-2xl border border-red-500/25 bg-red-500/5 px-5 py-4"
              >
                <p className="font-semibold capitalize text-red-200">{em.severity} · {em.status}</p>
                <p className="mt-1 text-sm text-[var(--cc-muted)]">{em.location ?? "Location on file"}</p>
                {em.response_eta_minutes != null && (
                  <p className="mt-1 text-sm text-[var(--cc-accent)]">
                    ETA was ~{em.response_eta_minutes} min
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-2xl font-bold">Your requests</h2>
        <p className="mt-1 text-sm text-[var(--cc-muted)]">
          Only visits from the last two hours appear here. See your full history on your profile.
        </p>
        <ul className="mt-6 flex flex-col gap-4">
          {recentRequests.length === 0 && (
            <li className="text-[var(--cc-muted)]">
              No recent bookings — your last two hours are clear, or book a new visit above.
            </li>
          )}
          {recentRequests.map((r) => {
            const payRow = firstOrNull(r.payments);
            const rateRow = firstOrNull(r.rating_feedback);
            const price = r.service_types?.base_price ?? 0;
            const showCancel = canCancelVisit(r, payRow);
            const canTrack =
              payRow == null && normalizeStatus(r.status) !== "completed";
            return (
              <li
                key={r.request_id}
                className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">
                      {r.service_types?.service_name ?? "Service"}
                    </p>
                    <p className="text-[var(--cc-muted)]">
                      {r.healthcare_providers?.name ?? "Provider TBD"} · {r.status}
                    </p>
                    <p className="mt-2 text-sm text-[var(--cc-muted)]">{r.location}</p>
                    {r.eta_minutes != null && (
                      <p className="mt-1 text-[var(--cc-accent)]">ETA ~{r.eta_minutes} min</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {canTrack ? (
                      <Link
                        href={`/track/${r.request_id}`}
                        className="focus-ring rounded-xl bg-[var(--cc-surface-2)] px-5 py-3 text-center text-base font-semibold text-[var(--cc-accent)]"
                      >
                        Track on map
                      </Link>
                    ) : (
                      <span className="rounded-xl border border-[var(--cc-border)] px-5 py-3 text-center text-sm text-[var(--cc-muted)]">
                        Tracking closed (paid)
                      </span>
                    )}
                    {showCancel && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => cancelVisit(r.request_id)}
                        className="focus-ring rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-base font-semibold text-red-300 hover:bg-red-500/20"
                      >
                        Cancel visit
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {payRow == null && normalizeStatus(r.status) !== "completed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pay(r.request_id, Number(price))}
                      className="rounded-xl border border-[var(--cc-border)] px-4 py-2 font-medium hover:border-[var(--cc-accent)]"
                    >
                      Pay ₹{Number(price).toFixed(0)}
                    </button>
                  )}
                  {payRow != null && rateRow == null && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-sm text-[var(--cc-muted)]">Rate visit:</span>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <button
                          key={n}
                          type="button"
                          disabled={busy}
                          onClick={() => submitFeedback(r.request_id, n)}
                          className="min-h-[44px] min-w-[44px] rounded-lg bg-[var(--cc-bg)] text-lg font-bold hover:bg-[var(--cc-accent-muted)]"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                  {rateRow != null && (
                    <span className="text-sm text-emerald-300">Thank you — feedback saved</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense
      fallback={<div className="py-24 text-center text-[var(--cc-muted)]">Loading…</div>}
    >
      <BookPageInner />
    </Suspense>
  );
}
