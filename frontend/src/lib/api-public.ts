const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

/** Unauthenticated JSON POST (e.g. provider self-registration). */
export async function apiPostPublic<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { error: text };
    }
  }
  if (!res.ok) {
    const err = (parsed as { error?: string })?.error || res.statusText;
    throw new Error(typeof err === "string" ? err : "Request failed");
  }
  return parsed as T;
}
