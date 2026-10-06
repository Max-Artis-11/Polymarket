"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerClock, syncedNow } from "../lib/clock";
import { usePriceFeeds } from "../lib/feeds";
import { usePolyBook } from "../lib/book";
import { fetchBinanceOpen, fetchEventBySlug, fetchOpenPrice, parseMarket, winnerOf } from "../lib/polymarket";
import { useStore } from "../lib/store";
import { walkBuy, walkSell } from "../lib/engine";
import { FILL_DELAY_MS, DEFAULT_BALANCE, TAKER_FEE_RATE, WINDOW_SEC } from "../lib/config";
import { fmtPnl, fmtUsd, fmtWindow } from "../lib/format";
import Chart from "./Chart";
import Ticket from "./Ticket";
import Drawer from "./Drawer";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Trader() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="boot">Loading…</div>;
  return <App />;
}

function Dot({ ok }) {
  return <span className={`dot ${ok ? "ok" : ""}`} />;
}

function App() {
  const now = useServerClock();
  const { bin, cl, status } = usePriceFeeds();
  const [mode, setMode] = useState("auto");
  const [showReset, setShowReset] = useState(false);
  const [customBal, setCustomBal] = useState("");
  const [toast, setToast] = useState(null);
  const [market, setMarket] = useState(null);
  const [ptb, setPtb] = useState(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("polypaper-theme") || "dark"; } catch { return "dark"; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("polypaper-theme", theme); } catch {}
  }, [theme]);

  const balance = useStore((s) => s.balance);
  const startBalance = useStore((s) => s.startBalance);
  const positions = useStore((s) => s.positions);
  const history = useStore((s) => s.history);

  const ws = Math.floor(now / 1000 / WINDOW_SEC) * WINDOW_SEC;
  const startMs = ws * 1000;
  const endMs = startMs + WINDOW_SEC * 1000;
  const msLeft = Math.max(0, endMs - now);

  // ---------- market discovery (cached + prefetches next window) ----------
  const mcache = useRef({});
  const getMarket = useCallback((w) => {
    if (!mcache.current[w]) {
      mcache.current[w] = (async () => {
        for (let i = 0; i < 200; i++) {
          try {
            const ev = await fetchEventBySlug(`btc-updown-5m-${w}`);
            const m = parseMarket(ev);
            if (m) return { ...m, windowStart: w, endMs: (w + WINDOW_SEC) * 1000 };
          } catch {}
          await sleep(1500);
        }
        return null;
      })();
    }
    return mcache.current[w];
  }, []);

  useEffect(() => {
    let dead = false;
    setMarket(null);
    getMarket(ws).then((m) => !dead && setMarket(m));
    getMarket(ws + WINDOW_SEC);
    for (const k of Object.keys(mcache.current)) if (+k < ws) delete mcache.current[k];
    return () => {
      dead = true;
    };
  }, [ws, getMarket]);

  // ---------- live order books ----------
  const { quotes, getBook, connected: clobLive } = usePolyBook(market?.upToken, market?.downToken);

  // ---------- price series selection ----------
  const pickSeries = useCallback(() => {
    const n = syncedNow();
    const c = cl.current;
    const b = bin.current;
    const clFresh = c.length && n - c[c.length - 1][0] < 6000;
    if (mode === "chainlink") return { arr: c, name: "Chainlink" };
    if (mode === "binance") return { arr: b, name: status.binName };
    return clFresh ? { arr: c, name: "Chainlink" } : { arr: b, name: status.binName };
  }, [mode, status.binName, bin, cl]);

  const series = pickSeries();
  const lastTick = series.arr[series.arr.length - 1];
  const cur = lastTick ? lastTick[1] : null;

  // ---------- price to beat ----------
  // 1) Polymarket's own open price (exact)  2) Chainlink tick at the window start
  // 3) Binance candle open corrected by the live Binance↔Chainlink basis (approximate)
  useEffect(() => {
    setPtb(null);
    if (!market) return;
    let dead = false;
    let timer;
    let attempt = 0;
    const nearTick = (arr) => {
      let best = null;
      let bd = 2500;
      for (let i = arr.length - 1; i >= 0; i--) {
        const d = Math.abs(arr[i][0] - startMs);
        if (d < bd) { bd = d; best = arr[i][1]; }
        if (arr[i][0] < startMs - 2500) break;
      }
      return best;
    };
    const put = (p) => setPtb((prev) => (prev && prev.exact ? prev : p));

    const run = async () => {
      if (attempt < 4 || attempt % 8 === 0) {
        const ex = await fetchOpenPrice(ws);
        if (dead) return true;
        if (ex != null) { setPtb({ v: ex, src: "Polymarket", exact: true }); return true; }
      }
      if (market.ptb != null) { setPtb({ v: market.ptb, src: "Polymarket", exact: true }); return true; }

      const v = nearTick(cl.current);
      if (v != null) { put({ v, src: "≈ Chainlink tick at window start", exact: false }); return false; }

      if (syncedNow() - startMs > 3000 && (attempt === 2 || attempt % 8 === 4)) {
        const open = await fetchBinanceOpen(startMs);
        if (dead) return true;
        if (open != null) {
          const c = cl.current;
          const b = bin.current;
          let adj = open;
          if (c.length && b.length && Math.abs(c[c.length - 1][0] - b[b.length - 1][0]) < 3000) {
            adj = open + (c[c.length - 1][1] - b[b.length - 1][1]); // remove the exchange basis
          }
          put({ v: adj, src: "≈ estimate (Binance open, Chainlink-adjusted)", exact: false });
        }
      }
      return false;
    };
    const loop = async () => {
      if (dead) return;
      const done = await run();
      attempt++;
      if (!done && !dead && attempt < 60) timer = setTimeout(loop, attempt < 6 ? 800 : 4000);
    };
    loop();
    return () => { dead = true; clearTimeout(timer); };
  }, [market, ws, startMs, bin, cl]);

  // ---------- order execution ----------
  const ctx = useRef({});
  ctx.current = { market, ptb };

  const runOrder = (o) => {
    const st = useStore.getState();
    const c = ctx.current;
    if (!c.market || c.market.slug !== o.slug) return { ok: false, msg: "Market rolled over before the order filled" };
    if (syncedNow() >= o.endMs) return { ok: false, msg: "Market closed before the order filled" };
    const book = getBook(o.side);
    if (o.type === "buy") {
      if (o.amount > st.balance + 1e-9) return { ok: false, msg: "Insufficient balance" };
      const r = walkBuy(book.asks, o.amount);
      if (!r.shares || r.spent < 0.01) return { ok: false, msg: "No liquidity on the ask side" };
      const cost = r.spent * (1 + TAKER_FEE_RATE);
      if (cost > st.balance + 1e-9) return { ok: false, msg: "Insufficient balance" };
      st.applyBuy({
        slug: o.slug, windowStart: c.market.windowStart, endMs: o.endMs, side: o.side,
        shares: r.shares, cost, ptb: c.ptb?.v ?? null,
      });
      return { ok: true, msg: `Bought ${r.shares.toFixed(2)} ${o.side} @ ${(r.avg * 100).toFixed(1)}¢ for ${fmtUsd(cost)}` };
    }
    const pos = st.positions.find((p) => p.slug === o.slug && p.side === o.side);
    if (!pos) return { ok: false, msg: "No position to sell" };
    const want = Math.min(o.amount, pos.shares);
    const r = walkSell(book.bids, want);
    if (!r.shares) return { ok: false, msg: "No liquidity on the bid side" };
    const proceeds = r.proceeds * (1 - TAKER_FEE_RATE);
    st.applySell({ slug: o.slug, windowStart: pos.windowStart, side: o.side, shares: r.shares, proceeds });
    return { ok: true, msg: `Sold ${r.shares.toFixed(2)} ${o.side} @ ${(r.avg * 100).toFixed(1)}¢ for ${fmtUsd(proceeds)}` };
  };
  const runOrderRef = useRef(runOrder);
  runOrderRef.current = runOrder;

  const onOrder = useCallback(async (o) => {
    await sleep(FILL_DELAY_MS); // Polymarket-style taker delay
    const r = runOrderRef.current(o);
    const id = Date.now() + Math.random();
    setToast({ ...r, id });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 4500);
    return r;
  }, []);

  // ---------- settlement via Polymarket's real outcome ----------
  useEffect(() => {
    const id = setInterval(async () => {
      const n = syncedNow();
      const slugs = [...new Set(useStore.getState().positions.filter((p) => p.endMs <= n).map((p) => p.slug))];
      for (const slug of slugs) {
        try {
          const ev = await fetchEventBySlug(slug);
          const w = winnerOf(ev);
          if (w) useStore.getState().settle(slug, w);
        } catch {}
      }
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // ---------- derived UI values ----------
  const mm = String(Math.floor(msLeft / 60000)).padStart(2, "0");
  const ss = String(Math.floor(msLeft / 1000) % 60).padStart(2, "0");
  const urgent = msLeft > 0 && msLeft <= 10000;
  const delta = cur != null && ptb ? cur - ptb.v : null;

  const openCost = positions.reduce((a, p) => a + p.cost, 0);
  const pnl = balance + openCost - startBalance;

  const doReset = (amt) => {
    useStore.getState().reset(amt);
    setShowReset(false);
    setCustomBal("");
  };

  return (
    <div className="app">
      <header className="top">
        <div className="lefttop">
          <button
            className="pill theme"
            aria-label="Toggle light / dark theme"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <div className="brand">
            <span className="logo">◆</span> PolyPaper <span className="tag">PAPER</span>
          </div>
        </div>
        <div className="feeds">
          <span><Dot ok={status.cl === "live"} /> Chainlink</span>
          <span><Dot ok={status.bin === "live"} /> {status.binName}</span>
          <span><Dot ok={clobLive} /> CLOB</span>
          <button className="pill" onClick={() => setMode((m) => (m === "auto" ? "chainlink" : m === "chainlink" ? "binance" : "auto"))}>
            Price: {mode}
          </button>
        </div>
        <div className="acct">
          <div>
            <div className="mute sm">Cash</div>
            <b>{fmtUsd(balance)}</b>
          </div>
          <div>
            <div className="mute sm">P&amp;L</div>
            <b className={pnl >= 0 ? "g" : "r"}>{fmtPnl(pnl)}</b>
          </div>
          <button className="pill" onClick={() => setShowReset(true)}>Reset</button>
        </div>
      </header>

      <main className="grid">
        <section className="left card">
          <div className="mhead">
            <div className="mtitle">
              <div className="btc">₿</div>
              <div>
                <h1>BTC Up or Down 5m</h1>
                <div className="mute">{fmtWindow(startMs)}</div>
              </div>
            </div>
            <div className={`cd ${urgent ? "urgent" : ""}`}>
              <div className="box"><b>{mm}</b><span>MINS</span></div>
              <div className="box"><b>{ss}</b><span>SECS</span></div>
            </div>
          </div>

          <div className="stats">
            <div>
              <div className="lab">Price To Beat</div>
              <div className="big ptb">{ptb ? money(ptb.v) : "—"}</div>
              {ptb && !ptb.exact && <div className="mute xs">{ptb.src}</div>}
              {!ptb && <div className="mute xs">locking in…</div>}
            </div>
            <div className="sep" />
            <div>
              <div className="lab orange">
                Current Price{" "}
                {delta != null && (
                  <span className={delta >= 0 ? "g" : "r"}>{delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}</span>
                )}
              </div>
              <div className="big orange">{cur != null ? money(cur) : "—"}</div>
              <div className="mute xs">{series.name}</div>
            </div>
          </div>

          <div className="chartwrap">
            <Chart getSeries={pickSeries} getNow={syncedNow} ptb={ptb ? ptb.v : null} theme={theme} />
          </div>
          {!market && <div className="mute xs pad">Finding this window's market on Polymarket…</div>}
        </section>

        <aside className="right card">
          <Ticket
            market={market}
            quotes={quotes}
            getBook={getBook}
            balance={balance}
            positions={positions}
            msLeft={msLeft}
            onOrder={onOrder}
          />
        </aside>
      </main>

      <Drawer positions={positions} history={history} market={market} quotes={quotes} msLeft={msLeft} onOrder={onOrder} />

      {toast && <div className={`toast ${toast.ok ? "ok" : "bad"}`}>{toast.msg}</div>}

      {showReset && (
        <div className="modal" onClick={() => setShowReset(false)}>
          <div className="mbox" onClick={(e) => e.stopPropagation()}>
            <h3>Reset paper account</h3>
            <p className="mute">Clears positions and history, then sets a fresh balance.</p>
            <div className="quick">
              <button onClick={() => doReset(DEFAULT_BALANCE)}>${DEFAULT_BALANCE}</button>
              <button onClick={() => doReset(Math.round(50 + Math.random() * 950))}>Random</button>
            </div>
            <div className="row gap">
              <input className="amt" placeholder="Custom amount" value={customBal} onChange={(e) => setCustomBal(e.target.value.replace(/[^0-9.]/g, ""))} />
              <button className="pill" disabled={!(parseFloat(customBal) > 0)} onClick={() => doReset(parseFloat(customBal))}>Set</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
