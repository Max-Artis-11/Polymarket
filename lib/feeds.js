"use client";
import { useEffect, useRef, useState } from "react";
import { syncedNow } from "./clock";
import { RTDS_WS } from "./config";

const KEEP_MS = 12 * 60 * 1000;

function pushTick(arr, t, p) {
  const last = arr[arr.length - 1];
  if (last && t >= last[0] && t - last[0] < 100) {
    last[1] = p; // throttle to ~10 pts/sec
    return;
  }
  if (last && t < last[0]) t = last[0];
  arr.push([t, p]);
  const cut = t - KEEP_MS;
  let n = 0;
  while (n < arr.length && arr[n][0] < cut) n++;
  if (n > 200) arr.splice(0, n);
}

// Fast BTC feed: Binance first, falling back to Binance.US then Coinbase
// (Binance blocks some regions, so we rotate automatically if it won't connect).
const FAST = [
  { name: "Binance", url: "wss://stream.binance.com:9443/ws/btcusdt@trade" },
  { name: "Binance.US", url: "wss://stream.binance.us:9443/ws/btcusdt@trade" },
  { name: "Coinbase", url: "wss://ws-feed.exchange.coinbase.com" },
];

export function usePriceFeeds() {
  const bin = useRef([]);
  const cl = useRef([]);
  const [status, setStatus] = useState({ bin: "connecting", cl: "connecting", binName: "Binance" });

  useEffect(() => {
    let dead = false;
    const timers = [];
    const sockets = [];
    const setS = (patch) => setStatus((s) => ({ ...s, ...patch }));

    // ---------- fast feed ----------
    let idx = 0;
    const openFast = () => {
      if (dead) return;
      const src = FAST[idx];
      let got = false;
      setS({ bin: "connecting", binName: src.name });
      let ws;
      try {
        ws = new WebSocket(src.url);
      } catch {
        idx = (idx + 1) % FAST.length;
        timers.push(setTimeout(openFast, 500));
        return;
      }
      sockets.push(ws);
      const guard = setTimeout(() => {
        if (!got) try { ws.close(); } catch {}
      }, 5000);
      ws.onopen = () => {
        if (src.name === "Coinbase")
          ws.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }));
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        let p = null;
        if (src.name === "Coinbase") {
          if (m.type === "ticker" && m.price) p = +m.price;
        } else if (m.p) p = +m.p;
        if (!p) return;
        if (!got) { got = true; setS({ bin: "live" }); }
        pushTick(bin.current, syncedNow(), p);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        clearTimeout(guard);
        if (dead) return;
        setS({ bin: "connecting" });
        if (!got) idx = (idx + 1) % FAST.length;
        timers.push(setTimeout(openFast, got ? 500 : 300));
      };
    };

    // ---------- Chainlink via Polymarket RTDS (the resolution source) ----------
    const openCl = () => {
      if (dead) return;
      let live = false;
      let ping;
      let ws;
      try {
        ws = new WebSocket(RTDS_WS);
      } catch {
        timers.push(setTimeout(openCl, 2000));
        return;
      }
      sockets.push(ws);
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
          const hist = pl.data.map((d) => [d.timestamp, +d.value]).filter((x) => x[0] && x[1]);
          if (hist.length) {
            const merged = [...hist, ...cl.current].sort((a, b) => a[0] - b[0]);
            cl.current.length = 0;
            for (const x of merged) cl.current.push(x);
          }
        } else if (pl.value != null && (!pl.symbol || String(pl.symbol).toLowerCase() === "btc/usd")) {
          pushTick(cl.current, syncedNow(), +pl.value);
          if (!live) { live = true; setS({ cl: "live" }); }
        }
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        clearInterval(ping);
        if (dead) return;
        setS({ cl: "connecting" });
        timers.push(setTimeout(openCl, 1500));
      };
    };

    openFast();
    openCl();
    return () => {
      dead = true;
      timers.forEach(clearTimeout);
      sockets.forEach((s) => { try { s.close(); } catch {} });
    };
  }, []);

  return { bin, cl, status };
}
