"use client";
import { useState } from "react";
import { walkBuy, walkSell } from "../lib/engine";
import { MIN_ORDER_USD, FILL_DELAY_MS } from "../lib/config";
import { cents, fmtUsd } from "../lib/format";

export default function Ticket({ market, quotes, getBook, balance, positions, msLeft, onOrder }) {
  const [type, setType] = useState("buy");
  const [side, setSide] = useState("Up");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const pos = positions.find((p) => p.slug === market?.slug && p.side === side);
  const a = parseFloat(amt) || 0;
  const closed = !market || msLeft <= 0;

  let est = null;
  if (market && a > 0) {
    const book = getBook(side);
    if (type === "buy") {
      const r = walkBuy(book.asks, a);
      if (r.shares) est = { shares: r.shares, avg: r.avg, total: r.spent };
    } else {
      const r = walkSell(book.bids, Math.min(a, pos?.shares || 0));
      if (r.shares) est = { shares: r.shares, avg: r.avg, total: r.proceeds };
    }
  }

  const valid =
    !closed &&
    est &&
    (type === "buy" ? a >= MIN_ORDER_USD && a <= balance + 1e-9 : !!pos && a > 0);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await onOrder({ type, side, amount: a, slug: market.slug, endMs: market.endMs });
    setBusy(false);
    setAmt("");
  };

  const priceOf = (s) => (type === "buy" ? quotes[s].ask : quotes[s].bid);
  const quick = type === "buy" ? [1, 5, 10, 25] : null;

  return (
    <div className="ticket">
      <div className="tabs">
        <button className={type === "buy" ? "on" : ""} onClick={() => { setType("buy"); setAmt(""); }}>Buy</button>
        <button className={type === "sell" ? "on" : ""} onClick={() => { setType("sell"); setAmt(""); }}>Sell</button>
      </div>

      <div className="label">Outcome</div>
      <div className="sides">
        <button className={`side up ${side === "Up" ? "on" : ""}`} onClick={() => setSide("Up")}>
          Up <b>{cents(priceOf("Up"))}</b>
        </button>
        <button className={`side down ${side === "Down" ? "on" : ""}`} onClick={() => setSide("Down")}>
          Down <b>{cents(priceOf("Down"))}</b>
        </button>
      </div>

      <div className="label row">
        <span>{type === "buy" ? "Amount ($)" : "Shares"}</span>
        <span className="mute">
          {type === "buy" ? `Balance ${fmtUsd(balance)}` : `You hold ${(pos?.shares || 0).toFixed(2)}`}
        </span>
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
            {quick.map((q) => (
              <button key={q} onClick={() => setAmt(String(Math.min(balance, (parseFloat(amt) || 0) + q)))}>+${q}</button>
            ))}
            <button onClick={() => setAmt(String(Math.floor(balance * 100) / 100))}>Max</button>
          </>
        ) : (
          <>
            {[0.25, 0.5].map((f) => (
              <button key={f} onClick={() => setAmt(((pos?.shares || 0) * f).toFixed(2))}>{f * 100}%</button>
            ))}
            <button onClick={() => setAmt((pos?.shares || 0).toFixed(2))}>Max</button>
          </>
        )}
      </div>

      <div className="est">
        {type === "buy" ? (
          <>
            <div className="row"><span>Est. shares</span><b>{est ? est.shares.toFixed(2) : "—"}</b></div>
            <div className="row"><span>Avg price</span><b>{est ? cents(est.avg) : "—"}</b></div>
            <div className="row"><span>Payout if {side} wins</span><b className="g">{est ? fmtUsd(est.shares) : "—"}</b></div>
          </>
        ) : (
          <>
            <div className="row"><span>Avg price</span><b>{est ? cents(est.avg) : "—"}</b></div>
            <div className="row"><span>Est. proceeds</span><b className="g">{est ? fmtUsd(est.total) : "—"}</b></div>
          </>
        )}
      </div>

      <button className={`go ${side === "Up" ? "up" : "down"}`} disabled={!valid || busy} onClick={submit}>
        {busy ? `Matching… (${FILL_DELAY_MS}ms delay)` : closed ? "Market closed" : `${type === "buy" ? "Buy" : "Sell"} ${side}`}
      </button>
      <div className="fine">
        Paper trading. Fills walk the live order book after a {FILL_DELAY_MS}ms taker delay.
      </div>
    </div>
  );
}
