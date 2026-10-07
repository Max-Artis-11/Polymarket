"use client";
import { useEffect, useRef, useState } from "react";
import { syncedNow } from "./clock";
import { RTDS_WS, TWAP_MS, PRICE_LAG_MS } from "./config";

// ---------------------------------------------------------------------------
// Polymarket's 5-minute BTC markets resolve on Chainlink's 60-second TWAP stream.
//   Price To Beat (window N) = TWAP at the window's start
//   Final price   (window N) = TWAP at the window's end  (= Price To Beat of N+1)
// That TWAP feed needs Polymarket API credentials, so we rebuild it ourselves from
// Polymarket's PUBLIC live Chainlink BTC/USD feed, then sample it once per second
// (exactly how Polymarket's own TWAP stream ticks).
// ---------------------------------------------------------------------------

const KEEP_MS = 10 * 60 * 1000;
const SAVE_KEY = "polypaper-cl-ticks-v1";
const MAX_GAP = 5000;

function lastIdxLE(arr, t) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m][0] <= t) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}

// time-weighted average of reports in (t-60s, t]; each report covers the time since the previous one
export function twapFrom(arr, t) {
  const i = lastIdxLE(arr, t);
  if (i < 0) return null;
  const from = t - TWAP_MS;
  let sum = 0;
  let wsum = 0;
  for (let k = i; k >= 0 && arr[k][0] > from; k--) {
    const prevTs = k > 0 ? arr[k - 1][0] : arr[k][0] - 1000;
    const w = Math.min(arr[k][0] - Math.max(prevTs, from), MAX_GAP);
    if (w > 0) { sum += arr[k][1] * w; wsum += w; }
  }
  return wsum > 0 ? sum / wsum : arr[i][1];
}

// true when we hold REAL Chainlink reports spanning the full 60s window ending at t
function coveredFrom(arr, t) {
  const from = t - TWAP_MS;
  const i = lastIdxLE(arr, t);
  if (i < 0 || t - arr[i][0] > 2500) return false;
  let prev = null;
  for (let k = i; k >= 0; k--) {
    const ts = arr[k][0];
    if (prev != null && prev - ts > MAX_GAP) return false;
    if (ts <= from) return true;
    if (!arr[k][2]) return false;
    if (k === 0) return ts <= from + 1000;
    prev = ts;
  }
  return false;
}

export function usePriceFeeds() {
  const ticks = useRef([]); // [ts, value, isRealChainlink]
  const sec = useRef([]);   // per-second TWAP [ts, value]  <- what we chart & display
  const [status, setStatus] = useState("connecting");
  const api = useRef(null);
  if (!api.current) {
    api.current = {
      twapAt: (t) => twapFrom(ticks.current, t),
      covered: (t) => {
        const a = ticks.current;
        return a.length > 0 && a[a.length - 1][0] >= t && coveredFrom(a, t);
      },
      getSec: () => sec.current,
    };
  }

  useEffect(() => {
    let dead = false;
    const timers = [];
    let ws;
    let ping;
    let lastSec = 0;
    let backfillDone = false;

    const resetSec = () => {
      sec.current.length = 0;
      lastSec = 0;
    };

    const merge = (list, real) => {
      const a = ticks.current;
      const map = new Map();
      for (const x of a) map.set(x[0], x);
      for (const [ts, v] of list) {
        if (!ts || !isFinite(v) || v <= 0) continue;
        const ex = map.get(ts);
        if (ex && ex[2] && !real) continue;
        map.set(ts, [ts, v, real]);
      }
      const cut = syncedNow() - KEEP_MS;
      const out = [...map.values()].filter((x) => x[0] >= cut).sort((x, y) => x[0] - y[0]);
      a.length = 0;
      for (const x of out) a.push(x);
      resetSec();
    };

    const addLive = (ts, v) => {
      const a = ticks.current;
      const last = a[a.length - 1];
      if (last && ts <= last[0]) {
        if (ts === last[0]) { last[1] = v; last[2] = true; }
        else merge([[ts, v]], true);
        return;
      }
      a.push([ts, v, true]);
      if (a.length > 1500) {
        const cut = ts - KEEP_MS;
        let n = 0;
        while (n < a.length && a[n][0] < cut) n++;
        if (n) a.splice(0, n);
      }
    };

    // restore recent real ticks so a page reload keeps an exact Price To Beat
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
      const cut = Date.now() - 6 * 60000;
      const ok = saved.filter((x) => Array.isArray(x) && x[0] > cut);
      if (ok.length) merge(ok, true);
    } catch {}

    // If we've just opened and lack history, borrow 1-second Binance candles (shifted onto
    // the Chainlink level) for the gap. Anything computed from these is flagged "≈".
    const backfill = async () => {
      if (backfillDone || dead) return;
      backfillDone = true;
      const firstReal = ticks.current.find((x) => x[2]);
      if (!firstReal || firstReal[0] <= syncedNow() - 4 * 60000) return;
      const urls = [
        "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=400",
        "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=400",
      ];
      let k = null;
      for (const u of urls) {
        try {
          const r = await fetch(u);
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j) && j.length > 30) { k = j; break; }
        } catch {}
      }
      if (!k || dead) return;
      const pts = k.map((x) => [x[0] + 1000, +x[4]]);
      const bmap = new Map(pts);
      const diffs = [];
      for (const x of ticks.current) {
        if (!x[2]) continue;
        const b = bmap.get(Math.round(x[0] / 1000) * 1000);
        if (b) diffs.push(x[1] - b);
      }
      let basis;
      if (diffs.length) {
        diffs.sort((a, b) => a - b);
        basis = diffs[Math.floor(diffs.length / 2)];
      } else {
        const lr = ticks.current[ticks.current.length - 1];
        basis = lr[1] - pts[pts.length - 1][1];
      }
      const first = ticks.current.find((x) => x[2]);
      merge(pts.filter(([ts]) => ts < first[0] - 500).map(([ts, v]) => [ts, v + basis]), false);
    };

    // sample the TWAP once per completed second
    const sampler = setInterval(() => {
      const a = ticks.current;
      if (!a.length) return;
      const n = syncedNow();
      const S = Math.floor((n - PRICE_LAG_MS) / 1000) * 1000;
      if (!lastSec) lastSec = Math.max(S - 240000, Math.floor(a[0][0] / 1000) * 1000) - 1000;
      const lt = a[a.length - 1][0];
      let added = 0;
      while (lastSec < S && added < 400) {
        const t = lastSec + 1000;
        if (lt < t && n - t < 4000) break; // wait for the report for this second
        const v = twapFrom(a, t);
        if (v != null) sec.current.push([t, v]);
        lastSec = t;
        added++;
      }
      if (sec.current.length > 900) sec.current.splice(0, sec.current.length - 900);
    }, 150);

    const saver = setInterval(() => {
      try {
        const cut = syncedNow() - 6 * 60000;
        const real = ticks.current.filter((x) => x[2] && x[0] > cut).map((x) => [x[0], x[1]]);
        localStorage.setItem(SAVE_KEY, JSON.stringify(real));
      } catch {}
    }, 5000);

    const open = () => {
      if (dead) return;
      let live = false;
      try {
        ws = new WebSocket(RTDS_WS);
      } catch {
        timers.push(setTimeout(open, 2000));
        return;
      }
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            action: "subscribe",
            subscriptions: [
              { topic: "crypto_prices_chainlink", type: "*", filters: JSON.stringify({ symbol: "btc/usd" }) },
            ],
          })
        );
        ping = setInterval(() => { try { ws.send("PING"); } catch {} }, 5000);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string" || e.data[0] !== "{") return;
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        const pl = m.payload;
        if (!pl) return;
        if (pl.symbol && String(pl.symbol).toLowerCase() !== "btc/usd") return;
        if (Array.isArray(pl.data)) {
          const hist = pl.data.map((d) => [+d.timestamp, +d.value]).filter((x) => x[0] && x[1]);
          if (hist.length) merge(hist, true);
        } else if (pl.value != null) {
          const n = syncedNow();
          const ts = +pl.timestamp;
          addLive(ts && Math.abs(ts - n) < 30000 ? ts : n, +pl.value);
          if (!live) {
            live = true;
            setStatus("live");
            timers.push(setTimeout(backfill, 3000));
          }
        }
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        clearInterval(ping);
        if (dead) return;
        setStatus("connecting");
        timers.push(setTimeout(open, 1500));
      };
    };

    open();
    return () => {
      dead = true;
      timers.forEach(clearTimeout);
      clearInterval(sampler);
      clearInterval(saver);
      clearInterval(ping);
      try { ws && ws.close(); } catch {}
    };
  }, []);

  return { ...api.current, status };
}
