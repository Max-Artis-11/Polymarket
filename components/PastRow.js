"use client";
import { fmtClockET } from "../lib/format";
import { WINDOW_SEC } from "../lib/config";

// Polymarket-style row under the chart: last 4 results, then window buttons labelled by end time.
export default function PastRow({ ws, resultOf }) {
  const past = [4, 3, 2, 1].map((k) => ({ w: ws - k * WINDOW_SEC, res: resultOf(ws - k * WINDOW_SEC) }));
  const prev = resultOf(ws - WINDOW_SEC);
  const label = (w) => fmtClockET((w + WINDOW_SEC) * 1000);

  return (
    <div className="pastrow">
      <div className="pastpill" title="Last 4 results">
        <span>Past</span>
        <span className="vsep" />
        {past.map(({ w, res }) => (
          <span
            key={w}
            className={`res ${res ? (res.winner === "Up" ? "up" : "down") : "unk"}${res && !res.official ? " pend" : ""}`}
            title={`${label(w)}: ${res ? res.winner + (res.official ? "" : " (resolving)") : "unknown"}`}
          >
            {res ? (res.winner === "Up" ? "▲" : "▼") : "·"}
          </span>
        ))}
      </div>
      <span className="tbtn" title="Previous window">
        {prev && !prev.official && <i className="pdot" />}
        {label(ws - WINDOW_SEC)}
      </span>
      <span className="tbtn on" title="Live window">
        <i className="ldot" />
        {label(ws)}
      </span>
      <span className="tbtn">{label(ws + WINDOW_SEC)}</span>
      <span className="tbtn hide-sm">{label(ws + 2 * WINDOW_SEC)}</span>
    </div>
  );
}
