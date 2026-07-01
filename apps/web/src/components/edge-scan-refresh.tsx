"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type EdgeScanRefreshProps = {
  initialScanId?: string | null;
  generatedAt?: string | null;
};

function formatPacificTime(value?: string | null): string {
  if (!value) return "Not stored yet";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

export function EdgeScanRefresh({ initialScanId, generatedAt }: EdgeScanRefreshProps) {
  const router = useRouter();
  const latestScanId = useRef(initialScanId ?? null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const displayTime = useMemo(() => formatPacificTime(generatedAt), [generatedAt]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const status = await response.json() as { scanId?: string; generatedAt?: string };
        if (cancelled) return;
        setLastCheckedAt(formatPacificTime(new Date().toISOString()));
        if (status.scanId && latestScanId.current && status.scanId !== latestScanId.current) {
          latestScanId.current = status.scanId;
          router.refresh();
        } else if (status.scanId && !latestScanId.current) {
          latestScanId.current = status.scanId;
        }
      } catch {
        // The next poll will retry; page data remains usable from the last snapshot.
      }
    }

    const timer = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [router]);

  return (
    <div>
      <div className="font-medium">{displayTime}</div>
      <div className="mt-1 text-xs text-muted">
        Pacific time. Auto-refreshes after each completed edge scan.
        {lastCheckedAt ? ` Last checked ${lastCheckedAt}.` : null}
      </div>
    </div>
  );
}
