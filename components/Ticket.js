"use client";
import { useEffect, useState } from "react";
import { walkBuy, walkSell } from "../lib/engine";
import { MIN_ORDER_USD, FILL_DELAY_MS, ONE_TAP_AMOUNTS } from "../lib/config";
import { cents, fmtUsd } from "../lib/format";

export default function Ticket({ market, quotes, getBook, balance, positions, msLeft, onOrder }) {
  const [type, setType] = useState("buy");
  const [side, setSide] = useState("Up");
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("polypaper-mode") || "tap"; } catch { return "tap"; }
  });
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    try { localStorage.setItem("polypaper-mode", mode); } catch {}
  }, [mode]);

  const pos = positions.find((p) => p.slug === market?.slug && p.side === side);
  const held = pos?.shares || 0;
  const closed = !market || msLeft <= 0;
  const book = market ? getBook(side) : { asks: [], bids: [] };

  const buyEst = (d) => { const r = walkBuy(book.asks, d); return r.shares ? r : null; };
  const sellEst = (s) => { const r = walkSell(book.bids, s); return r.shares ? r : null; };

  const fire = async (key, order) => {
    if (busy || closed) return;
    setBusy(key);
    await onOrder({ ...order, side, slug: market.slug, endMs: market.endMs });
    setBusy(null);
  };

  const priceOf = (s) => (type === "buy" ? quotes[s].ask : quotes[s].bid);

  // ----- amount mode -----
  const a = parseFloat(amt) || 0;
  let est = null;
  if (market && a > 0) {
    if (type === "buy") {
      const r = buyEst(a);
      if (r) est = { shares: r.shares, avg: r.avg, total: r.spent };
    } else {
      const r = sellEst(Math.min(a, held));
      if (r) est = { shares: r.shares, avg: r.avg, total: r.proceeds };
    }
  }
  const valid =
    !closed && est && (type === "buy" ? a >= MIN_ORDER_USD && a <= balance + 1e-9 : held > 0 && a > 0);

  return (
    <div className="ticket">
      <div className="thead">
        <div className="btc sm">₿</div>
        <div>
          <div className="mute xs2">BTC Up or Down 5m</div>
          <div className={side === "Up" ? "g b" : "r b"}>{side}</div>
        </div>
      </div>

      <div className="tabs">
        <button className={type === "buy" ? "on" : ""} onClick={() => { setType("buy"); setAmt(""); }}>Buy</button>
        <button className={type === "sell" ? "on" : ""} onClick={() => { setType("sell"); setAmt(""); }}>Sell</button>
        <select className="mode" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Order mode">
          <option value="tap">1-Tap</option>
          <option value="amount">Amount</option>
        </select>
      </div>

      <div className="sides">
        <button className={`side up ${side === "Up" ? "on" : ""}`} onClick={() => setSide("Up")}>
          Up {cents(priceOf("Up"))}
        </button>
        <button className={`side down ${side === "Down" ? "on" : ""}`} onClick={() => setSide("Down")}>
          Down {cents(priceOf("Down"))}
        </button>
      </div>

      {mode === "tap" ? (
        <>
          <div className="taplabel">
            {type === "buy" ? "One-tap buy" : "One-tap sell"}
            <span className="mute xs">{type === "buy" ? `Cash ${fmtUsd(balance)}` : `You hold ${held.toFixed(2)}`}</span>
          </div>
          <div className="taps">
            {type === "buy"
              ? ONE_TAP_AMOUNTS.map((d) => {
                  const r = buyEst(d);
                  const dis = closed || !r || d > balance + 1e-9;
                  return (
                    <button key={d} className="tap" disabled={dis || !!busy} onClick={() => fire(`b${d}`, { type: "buy", amount: d })}>
                      <b>{busy === `b${d}` ? "…" : `$${d}`}</b>
                      <span>win <em className="g">{r ? fmtUsd(r.shares) : "—"}</em></span>
                    </button>
                  );
                })
              : [0.25, 0.5, 1].map((f) => {
                  const sh = held * f;
                  const r = sh > 0 ? sellEst(sh) : null;
                  const dis = closed || !r;
                  return (
                    <button key={f} className="tap" disabled={dis || !!busy} onClick={() => fire(`s${f}`, { type: "sell", amount: sh })}>
                      <b>{busy === `s${f}` ? "…" : f === 1 ? "All" : `${f * 100}%`}</b>
                      <span>get <em className="g">{r ? fmtUsd(r.proceeds) : "—"}</em></span>
                    </button>
                  );
                })}
          </div>
          {closed && (
            <div className="fine">{market ? "Market closed. Next window opens in a moment." : "Loading this window's market…"}</div>
          )}
        </>
      ) : (
        <>
          <div className="label row">
            <span>{type === "buy" ? "Amount ($)" : "Shares"}</span>
            <span className="mute">{type === "buy" ? `Balance ${fmtUsd(balance)}` : `You hold ${held.toFixed(2)}`}</span>
          </div>
          <input
            className="amt"
            inputMode="decimal"
            placeholder="0"
            value={amt}
            onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <div className="quick">
            {type === "buy" ? (
              <>
                {[1, 5, 10, 25].map((q) => (
                  <button key={q} onClick={() => setAmt(String(Math.min(balance, (parseFloat(amt) || 0) + q)))}>+${q}</button>
                ))}
                <button onClick={() => setAmt(String(Math.floor(balance * 100) / 100))}>Max</button>
              </>
            ) : (
              <>
                {[0.25, 0.5].map((f) => (
                  <button key={f} onClick={() => setAmt((held * f).toFixed(2))}>{f * 100}%</button>
                ))}
                <button onClick={() => setAmt(held.toFixed(2))}>Max</button>
              </>
            )}
          </div>
          <div className="est">
            {type === "buy" ? (
              <>
                <div className="row"><span>Est. shares</span><b>{est ? est.shares.toFixed(2) : "—"}</b></div>
                <div className="row"><span>Avg price</span><b>{est ? cents(est.avg) : "—"}</b></div>
                <div className="row"><span>To win</span><b className="g">{est ? fmtUsd(est.shares) : "—"}</b></div>
              </>
            ) : (
              <>
                <div className="row"><span>Avg price</span><b>{est ? cents(est.avg) : "—"}</b></div>
                <div className="row"><span>Est. proceeds</span><b className="g">{est ? fmtUsd(est.total) : "—"}</b></div>
              </>
            )}
          </div>
          <button
            className={`go ${side === "Up" ? "up" : "down"}`}
            disabled={!valid || !!busy}
            onClick={() => fire("amt", { type, amount: a }).then(() => setAmt(""))}
          >
            {busy ? "Matching…" : !market ? "Loading market…" : closed ? "Market closed" : `${type === "buy" ? "Buy" : "Sell"} ${side}`}
          </button>
        </>
      )}
      <div className="fine">Paper trading. Orders fill against the live Polymarket order book after a {FILL_DELAY_MS}ms delay.</div>
    </div>
  );
}
