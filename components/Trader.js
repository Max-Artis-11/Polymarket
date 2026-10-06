"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerClock, syncedNow } from "../lib/clock";
import { usePriceFeeds } from "../lib/feeds";
import { usePolyBook } from "../lib/book";
import { fetchEventBySlug, parseMarket, winnerOf } from "../lib/polymarket";
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
  const { tw, status } = usePriceFeeds();
  const [showReset, setShowReset] = useState(false);
  const [customBal, setCustomBal] = useState("");
  const [toast, setToast] = useState(null);
  const [market, setMarket] = useState(null);
  const [ptbLive, setPtbLive] = useState(null);
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
  const slug = `btc-updown-5m-${ws}`;

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

  // ---------- chart series: Polymarket's 60s TWAP price ----------
  const pickSeries = useCallback(() => ({ arr: tw.current, name: "twap" }), [tw]);
  const lastTick = tw.current[tw.current.length - 1];
  const cur = lastTick ? lastTick[1] : null;

  // ---------- price to beat: Gamma's eventMetadata.priceToBeat (what Polymarket's page shows) ----------
  useEffect(() => {
    setPtbLive(market?.ptb ?? null);
    if (!market || market.ptb != null) return;
    let dead = false;
    let timer;
    const poll = async () => {
      if (dead) return;
      try {
        const m = parseMarket(await fetchEventBySlug(market.slug));
        if (m && m.ptb != null) { if (!dead) setPtbLive(m.ptb); return; }
      } catch {}
      timer = setTimeout(poll, 1500);
    };
    poll();
    return () => { dead = true; clearTimeout(timer); };
  }, [market]);

  // temporary stand-in only if Polymarket hasn't published it yet: our own TWAP at window start
  let ptb = ptbLive != null ? { v: ptbLive, exact: true } : null;
  if (!ptb && now - startMs > 8000) {
    let best = null;
    let bd = 3000;
    const arr = tw.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const d = Math.abs(arr[i][0] - startMs);
      if (d < bd) { bd = d; best = arr[i][1]; }
      if (arr[i][0] < startMs - 3000) break;
    }
    if (best != null) ptb = { v: best, exact: false };
  }

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
      for (const sl of slugs) {
        try {
          const ev = await fetchEventBySlug(sl);
          const w = winnerOf(ev);
          if (w) useStore.getState().settle(sl, w);
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
          <span><Dot ok={status.cl === "live"} /> Price feed</span>
          <span><Dot ok={clobLive} /> Order book</span>
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
              {ptb && !ptb.exact && <div className="mute xs">≈ estimate, updating…</div>}
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

      <section className="embed card">
        <div className="etitle">
          Polymarket's own widget for this window
          <a href={`https://polymarket.com/event/${slug}`} target="_blank" rel="noopener noreferrer">View on Polymarket ↗</a>
        </div>
        <iframe
          key={slug}
          title={`Polymarket BTC Up or Down 5m (${slug})`}
          src={`https://embed.polymarket.com/market?market=${slug}&height=300`}
          width="400"
          height="300"
          frameBorder="0"
          allowTransparency="true"
          loading="lazy"
        />
      </section>

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
