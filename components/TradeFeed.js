"use client";
import { useEffect, useState } from "react";

// Live trades on this market, stacked bottom-left of the chart like Polymarket ("+ $27").
// Green = someone bought Up, red = Down.
export default function TradeFeed({ getTrades }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const id = setInterval(() => setItems(getTrades().slice(-5)), 300);
    return () => clearInterval(id);
  }, [getTrades]);
  if (!items.length) return null;
  return (
    <div className="tfeed" aria-hidden="true">
      {items.map((t, i) => (
        <div key={t.id} className={t.side === "Up" ? "g" : "r"} style={{ opacity: 0.3 + (0.7 * (i + 1)) / items.length }}>
          + ${Math.max(1, Math.round(t.usd)).toLocaleString("en-US")}
        </div>
      ))}
    </div>
  );
}
