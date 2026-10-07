"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerClock, syncedNow } from "../lib/clock";
import { usePriceFeeds } from "../lib/feeds";
import { usePolyBook } from "../lib/book";
import { fetchBook, fetchEventBySlug, metaOf, outcomePrice, parseMarket, winnerOf } from "../lib/polymarket";
import { getWin, setWin, resultOf } from "../lib/windows";
import { useStore } from "../lib/store";
import { walkBuy, walkSell } from "../lib/engine";
import { FILL_DELAY_MS, DEFAULT_BALANCE, TAKER_FEE_RATE, WINDOW_SEC } from "../lib/config";
import { cents, fmtPnl, fmtUsd, fmtWindow, money } from "../lib/format";
import Chart from "./Chart";
import Ticket from "./Ticket";
import Drawer from "./Drawer";
import TradeFeed from "./TradeFeed";
import PastRow from "./PastRow";
import Embed from "./Embed";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const feeds = usePriceFeeds();
  const [showReset, setShowReset] = useState(false);
  const [customBal, setCustomBal] = useState("");
  const [toast, setToast] = useState(null);
  const [market, setMarket] = useState(null);
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

  const showToast = useCallback((r) => {
    const id = Date.now() + Math.random();
    setToast({ ...r, id });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 4500);
  }, []);

  // ---------- market discovery (cached + prefetches next window) ----------
  const mcache = useRef({});
  const getMarket = useCallback((w) => {
    if (!mcache.current[w]) {
      mcache.current[w] = (async () => {
        for (let i = 0; i < 200; i++) {
          try {
            const m = parseMarket(await fetchEventBySlug(`btc-updown-5m-${w}`));
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
    return () => { dead = true; };
  }, [ws, getMarket]);

  // ---------- live order books + trades ----------
  const { quotes, getBook, getTrades, connected: clobLive } = usePolyBook(market?.upToken, market?.downToken);

  // ---------- price to beat (= 60s Chainlink TWAP at the window start) ----------
  // exact once we hold real Chainlink reports for the full minute before the start;
  // otherwise a "≈" estimate that upgrades itself the moment it can.
  useEffect(() => {
    const id = setInterval(() => {
      const n = syncedNow();
      const w = Math.floor(n / 1000 / WINDOW_SEC) * WINDOW_SEC;
      const t = w * 1000;
      const c = getWin(w) || {};
      if (!c.ptbExact && n >= t + 1200) {
        if (feeds.covered(t)) {
          const v = feeds.twapAt(t);
          if (v != null) setWin(w, { ptb: v, ptbExact: true });
        } else if (c.ptb == null || n - (c.ptbAt || 0) > 3000) {
          const v = feeds.twapAt(t);
          if (v != null) setWin(w, { ptb: v, ptbExact: false, ptbAt: n });
        }
      }
      // the previous window's final price IS this window's price to beat
      const cur = getWin(w);
      const prev = getWin(w - WINDOW_SEC) || {};
      if (cur?.ptb != null && !prev.finalExact && (prev.final == null || cur.ptbExact || prev.final !== cur.ptb)) {
        setWin(w - WINDOW_SEC, { final: cur.ptb, finalExact: !!cur.ptbExact });
      }
    }, 250);
    return () => clearInterval(id);
  }, [feeds.covered, feeds.twapAt]);

  // ---------- official results from Polymarket for recent windows ----------
  useEffect(() => {
    let dead = false;
    let timer;
    const run = async () => {
      for (let k = 1; k <= 4; k++) {
        const w = ws - k * WINDOW_SEC;
        if (getWin(w)?.gWinner) continue;
        try {
          const ev = await fetchEventBySlug(`btc-updown-5m-${w}`);
          if (dead) return;
          const md = metaOf(ev);
          const patch = {};
          if (md.ptb != null) {
            patch.ptb = md.ptb;
            patch.ptbExact = true;
            setWin(w - WINDOW_SEC, { final: md.ptb, finalExact: true });
          }
          if (md.final != null) { patch.final = md.final; patch.finalExact = true; }
          const wn = winnerOf(ev);
          if (wn) patch.gWinner = wn;
          else if (md.ptb != null && md.final != null) patch.gWinner = md.final >= md.ptb ? "Up" : "Down";
          if (Object.keys(patch).length) setWin(w, patch);
        } catch {}
      }
      if (!dead) timer = setTimeout(run, 12000);
    };
    timer = setTimeout(run, 2500);
    return () => { dead = true; clearTimeout(timer); };
  }, [ws]);

  const win = getWin(ws);
  const ptb = win?.ptb != null ? { v: win.ptb, exact: !!win.ptbExact } : null;
  const secArr = feeds.getSec();
  const cur = secArr.length ? secArr[secArr.length - 1][1] : null;

  // ---------- order execution (live market) ----------
  const ctx = useRef({});
  ctx.current = { market };

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
        slug: o.slug, windowStart: c.market.windowStart, endMs: o.endMs, side: o.side, shares: r.shares, cost,
        tokenId: o.side === "Up" ? c.market.upToken : c.market.downToken,
      });
      return { ok: true, msg: `Bought ${r.shares.toFixed(2)} ${o.side} @ ${cents(r.avg)} for ${fmtUsd(cost)}` };
    }
    const pos = st.positions.find((p) => p.slug === o.slug && p.side === o.side);
    if (!pos) return { ok: false, msg: "No position to sell" };
    const r = walkSell(book.bids, Math.min(o.amount, pos.shares));
    if (!r.shares) return { ok: false, msg: "No liquidity on the bid side" };
    const proceeds = r.proceeds * (1 - TAKER_FEE_RATE);
    st.applySell({ slug: o.slug, windowStart: pos.windowStart, side: o.side, shares: r.shares, proceeds });
    return { ok: true, msg: `Sold ${r.shares.toFixed(2)} ${o.side} @ ${cents(r.avg)} for ${fmtUsd(proceeds)}` };
  };
  const runOrderRef = useRef(runOrder);
  runOrderRef.current = runOrder;

  const onOrder = useCallback(async (o) => {
    await sleep(FILL_DELAY_MS); // Polymarket-style taker delay
    const r = runOrderRef.current(o);
    showToast(r);
    return r;
  }, [showToast]);

  // ---------- "Sell Now Anyway": cash out an ended market before it officially resolves ----------
  // Sells into that market's real order book (it keeps trading at ~99.9¢ / ~0.1¢ until
  // resolution). Falls back to Polymarket's quoted outcome price, then to our own result.
  const onCashout = useCallback(async (p) => {
    await sleep(FILL_DELAY_MS);
    const find = () => useStore.getState().positions.find((x) => x.slug === p.slug && x.side === p.side);
    const pos = find();
    if (!pos) return showToast({ ok: false, msg: "That position is already closed" });

    let tokenId = pos.tokenId;
    let ev = null;
    if (!tokenId) {
      try {
        ev = await fetchEventBySlug(pos.slug);
        const m = parseMarket(ev);
        if (m) tokenId = pos.side === "Up" ? m.upToken : m.downToken;
      } catch {}
    }
    let proceeds = 0;
    let filled = 0;
    if (tokenId) {
      const b = await fetchBook(tokenId);
      if (b) {
        const r = walkSell(b.bids, pos.shares);
        proceeds = r.proceeds;
        filled = r.shares;
      }
    }
    const left = pos.shares - filled;
    if (left > 1e-6) {
      let px = null;
      try {
        if (!ev) ev = await fetchEventBySlug(pos.slug);
        px = outcomePrice(ev, pos.side);
      } catch {}
      if (px == null) {
        const res = resultOf(pos.windowStart);
        if (res) px = res.winner === pos.side ? 1 : 0;
      }
      if (px == null) return showToast({ ok: false, msg: "Couldn't price it right now, try again in a few seconds" });
      proceeds += left * px;
    }
    proceeds *= 1 - TAKER_FEE_RATE;
    if (!find()) return showToast({ ok: false, msg: "It settled while selling, check History" });
    useStore.getState().applySell({
      slug: pos.slug, windowStart: pos.windowStart, side: pos.side, shares: pos.shares, proceeds, label: "CASH OUT",
    });
    showToast({ ok: true, msg: `Sold ${pos.shares.toFixed(2)} ${pos.side} now for ${fmtUsd(proceeds)} (${cents(proceeds / pos.shares)} avg)` });
  }, [showToast]);

  // ---------- automatic settlement once Polymarket resolves ----------
  useEffect(() => {
    const id = setInterval(async () => {
      const n = syncedNow();
      const slugs = [...new Set(useStore.getState().positions.filter((p) => p.endMs <= n).map((p) => p.slug))];
      for (const sl of slugs) {
        try {
          const w = winnerOf(await fetchEventBySlug(sl));
          if (w) useStore.getState().settle(sl, w);
        } catch {}
      }
    }, 5000);
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
          <button className="pill theme" aria-label="Toggle light / dark theme" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <div className="brand">
            <span className="logo">◆</span> PolyPaper <span className="tag">PAPER</span>
          </div>
        </div>
        <div className="feeds">
          <span><Dot ok={feeds.status === "live"} /> Price feed</span>
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
              {ptb && !ptb.exact && <div className="mute xs" title="Opened mid-window without a full minute of live data before the start. Exact from the next window.">≈ estimate</div>}
              {!ptb && <div className="mute xs">locking in…</div>}
            </div>
            <div className="sep" />
            <div>
              <div className="lab orange">
                Current Price{" "}
                {delta != null && (
                  <span className={delta >= 0 ? "g" : "r"}>{delta >= 0 ? "▲" : "▼"}${Math.abs(delta).toFixed(0)}</span>
                )}
              </div>
              <div className="big orange">{cur != null ? money(cur) : "—"}</div>
            </div>
          </div>

          <div className="chartwrap">
            <Chart getSeries={feeds.getSec} ptb={ptb ? ptb.v : null} theme={theme} />
            <TradeFeed getTrades={getTrades} />
          </div>
          <PastRow ws={ws} resultOf={resultOf} />
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

      <Drawer
        positions={positions}
        history={history}
        market={market}
        quotes={quotes}
        msLeft={msLeft}
        onOrder={onOrder}
        onCashout={onCashout}
        resultOf={resultOf}
      />

      <Embed slug={slug} windowLabel={fmtWindow(startMs)} theme={theme} />

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
