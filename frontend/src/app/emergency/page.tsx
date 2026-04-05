"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Legacy route: emergency booking now starts from Book visit with ambulance pre-selected. */
export default function EmergencyRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/book?emergency=1");
  }, [router]);
  return (
    <div className="py-24 text-center text-[var(--cc-muted)]">
      Taking you to book a visit with ambulance selected…
    </div>
  );
}
