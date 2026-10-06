"use client";
import { useEffect, useState } from "react";

// Offset between the user's clock and real time, measured against our own
// /api/time route (Vercel servers are NTP-synced). Keeps the 5-min boundaries exact.
let OFFSET = 0;
export const syncedNow = () => Date.now() + OFFSET;

async function syncOnce() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    try {
      const w0 = Date.now();
      const t0 = performance.now();
      const r = await fetch(`/api/time?x=${Math.random()}`, { cache: "no-store" });
      const j = await r.json();
      const rtt = performance.now() - t0;
      const off = j.t - (w0 + rtt / 2);
      if (!best || rtt < best.rtt) best = { rtt, off };
    } catch {}
  }
  if (best) OFFSET = best.off;
}

export function useServerClock() {
  const [now, setNow] = useState(() => syncedNow());
  useEffect(() => {
    syncOnce();
    const s = setInterval(syncOnce, 5 * 60 * 1000);
    const t = setInterval(() => setNow(syncedNow()), 100);
    return () => {
      clearInterval(s);
      clearInterval(t);
    };
  }, []);
  return now;
}
