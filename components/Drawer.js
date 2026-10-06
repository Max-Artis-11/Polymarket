"use client";
import { useState } from "react";
import { cents, fmtPnl, fmtUsd, fmtWindow } from "../lib/format";

export default function Drawer({ positions, history, market, quotes, msLeft, onOrder }) {
  const [tab, setTab] = useState("pos");
  const [busyId, setBusyId] = useState(null);

  const sell = async (p) => {
    setBusyId(p.id);
    await onOrder({ type: "sell", side: p.side, amount: p.shares, slug: p.slug, endMs: p.endMs });
    setBusyId(null);
  };

  return (
    <section className="drawer card">
      <div className="dtabs">
        <button className={tab === "pos" ? "on" : ""} onClick={() => setTab("pos")}>
          Open positions <span className="badge">{positions.length}</span>
        </button>
        <button className={tab === "hist" ? "on" : ""} onClick={() => setTab("hist")}>History</button>
      </div>

      {tab === "pos" && (
        <div className="table">
          <div className="tr th">
            <span>Market</span><span>Side</span><span>Shares</span><span>Avg</span><span>Mark</span><span>Value</span><span>P&amp;L</span><span></span>
          </div>
          {positions.length === 0 && <div className="empty">No open positions. Buy Up or Down to start.</div>}
          {positions.map((p) => {
            const live = p.slug === market?.slug && msLeft > 0;
            const mark = live ? quotes[p.side].bid : null;
            const value = mark != null ? mark * p.shares : null;
            const pnl = value != null ? value - p.cost : null;
            return (
              <div className="tr" key={p.id}>
                <span>{fmtWindow(p.windowStart * 1000, false)}</span>
                <span className={p.side === "Up" ? "g" : "r"}>{p.side}</span>
                <span>{p.shares.toFixed(2)}</span>
                <span>{cents(p.cost / p.shares)}</span>
                <span>{live ? cents(mark) : "—"}</span>
                <span>{value != null ? fmtUsd(value) : "—"}</span>
                <span className={pnl == null ? "" : pnl >= 0 ? "g" : "r"}>{pnl != null ? fmtPnl(pnl) : "Resolving…"}</span>
                <span>
                  {live && (
                    <button className="mini" disabled={busyId === p.id} onClick={() => sell(p)}>
                      {busyId === p.id ? "…" : "Sell all"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {tab === "hist" && (
        <div className="table">
          <div className="tr th h">
            <span>Time</span><span>Type</span><span>Market</span><span>Side</span><span>Shares</span><span>Price</span><span>Amount</span><span>P&amp;L</span>
          </div>
          {history.length === 0 && <div className="empty">No trades yet.</div>}
          {history.map((h) => (
            <div className="tr h" key={h.id}>
              <span>{new Date(h.ts).toLocaleTimeString()}</span>
              <span>{h.type === "SETTLE" ? (h.pnl >= 0 ? "WIN" : "LOSS") : h.type}</span>
              <span>{fmtWindow(h.windowStart * 1000, false)}</span>
              <span className={h.side === "Up" ? "g" : "r"}>{h.side}</span>
              <span>{h.shares.toFixed(2)}</span>
              <span>{cents(h.price)}</span>
              <span>{fmtUsd(h.amount)}</span>
              <span className={h.pnl == null ? "" : h.pnl >= 0 ? "g" : "r"}>{h.pnl != null ? fmtPnl(h.pnl) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
