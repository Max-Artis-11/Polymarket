"use client";
import { useEffect, useRef, useState } from "react";
import { syncedNow } from "./clock";
import { RTDS_WS } from "./config";

// Polymarket's 5-minute BTC markets resolve on Chainlink's 60-second TWAP stream
// (btc-usd-twap-60s). Polymarket's "Price To Beat" and "Current Price" are that smoothed
// number, not the raw spot price. We listen to Polymarket's own live Chainlink spot feed
// and compute the same trailing 60s time-weighted average, which gives the same smooth line.

const KEEP_MS = 12 * 60 * 1000;
const TWAP_MS = 60000;

// time-weighted average of spot over (t-60s, t]; each tick holds until the next one
function twapAt(spot, t) {
  let i = spot.length - 1;
  while (i >= 0 && spot[i][0] > t) i--;
  if (i < 0) return null;
  const from = t - TWAP_MS;
  let sum = 0;
  let span = 0;
  let end = t;
  for (let k = i; k >= 0; k--) {
    const st = Math.max(spot[k][0], from);
    const d = end - st;
    if (d > 0) { sum += spot[k][1] * d; span += d; }
    end = st;
    if (spot[k][0] <= from) break;
  }
  return span > 0 ? sum / span : spot[i][1];
}

export function usePriceFeeds() {
  const cl = useRef([]); // raw spot ticks [ts, value]
  const tw = useRef([]); // 60s TWAP series [ts, value]  <- what we chart & display
  const [status, setStatus] = useState({ cl: "connecting" });

  useEffect(() => {
    let dead = false;
    const timers = [];
    let ws;
    let backfilled = false;

    const rebuild = () => {
      const spot = cl.current;
      tw.current.length = 0;
      for (let i = 0; i < spot.length; i++) {
        const v = twapAt(spot.slice(0, i + 1), spot[i][0]);
        if (v != null) tw.current.push([spot[i][0], v]);
      }
    };

    const addTick = (ts, v) => {
      const s = cl.current;
      const last = s[s.length - 1];
      if (last && ts < last[0]) return;
      if (last && ts === last[0]) {
        last[1] = v;
        const t = tw.current[tw.current.length - 1];
        if (t) t[1] = twapAt(s, ts);
        return;
      }
      s.push([ts, v]);
      tw.current.push([ts, twapAt(s, ts)]);
      const cut = ts - KEEP_MS;
      let n = 0;
      while (n < s.length && s[n][0] < cut) n++;
      if (n > 100) { s.splice(0, n); tw.current.splice(0, n); }
    };

    // If we don't yet have 60s of history (page just opened), borrow a minute of 1-second
    // candles (shifted to line up with the live feed) so the average is right immediately.
    const backfill = async () => {
      if (backfilled) return;
      backfilled = true;
      try {
        const c = cl.current;
        if (!c.length || c[c.length - 1][0] - c[0][0] >= TWAP_MS + 5000) return;
        const r = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=100");
        if (!r.ok) return;
        const k = await r.json();
        const first = cl.current[0];
        let bi = -1;
        let bd = Infinity;
        k.forEach((x, i) => {
          const d = Math.abs(x[0] - first[0]);
          if (d < bd) { bd = d; bi = i; }
        });
        if (bi < 0 || bd > 5000) return;
        const basis = first[1] - +k[bi][4];
        const pre = [];
        for (let i = 0; i < bi; i++) {
          const ts = k[i][0] + 1000;
          if (ts < first[0] - 500) pre.push([ts, +k[i][4] + basis]);
        }
        const merged = [...pre, ...cl.current];
        cl.current.length = 0;
        merged.forEach((x) => cl.current.push(x));
        rebuild();
      } catch {}
    };

    const open = () => {
      if (dead) return;
      let live = false;
      let ping;
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
        if (Array.isArray(pl.data)) {
          const hist = pl.data.map((d) => [+d.timestamp, +d.value]).filter((x) => x[0] && x[1]);
          if (hist.length) {
            const merged = [...hist, ...cl.current].sort((a, b) => a[0] - b[0]);
            const dedup = merged.filter((x, i) => i === 0 || x[0] !== merged[i - 1][0]);
            cl.current.length = 0;
            dedup.forEach((x) => cl.current.push(x));
            rebuild();
          }
        } else if (pl.value != null && (!pl.symbol || String(pl.symbol).toLowerCase() === "btc/usd")) {
          const n = syncedNow();
          const ts = +pl.timestamp;
          addTick(ts && Math.abs(ts - n) < 30000 ? ts : n, +pl.value);
          if (!live) {
            live = true;
            setStatus({ cl: "live" });
            timers.push(setTimeout(backfill, 1500));
          }
        }
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        clearInterval(ping);
        if (dead) return;
        setStatus({ cl: "connecting" });
        timers.push(setTimeout(open, 1500));
      };
    };

    open();
    return () => {
      dead = true;
      timers.forEach(clearTimeout);
      try { ws && ws.close(); } catch {}
    };
  }, []);

  return { cl, tw, status };
}
