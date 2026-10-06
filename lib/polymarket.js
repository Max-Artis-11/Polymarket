import { GAMMA } from "./config";

const toArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
};

export async function fetchEventBySlug(slug) {
  let r;
  try {
    r = await fetch(`${GAMMA}/events?slug=${slug}`, { cache: "no-store" });
    if (!r.ok) throw new Error("gamma " + r.status);
  } catch {
    r = await fetch(`/api/gamma?slug=${slug}`, { cache: "no-store" });
  }
  const j = await r.json();
  return Array.isArray(j) ? j[0] : null;
}

export function parseMarket(ev) {
  const m = ev?.markets?.[0];
  if (!m) return null;
  const tokens = toArr(m.clobTokenIds);
  const outs = toArr(m.outcomes);
  if (!tokens || !outs || tokens.length < 2) return null;
  const iUp = outs.findIndex((o) => /^up/i.test(o));
  const iDown = outs.findIndex((o) => /^down/i.test(o));
  if (iUp < 0 || iDown < 0) return null;
  const ptbRaw = ev.eventMetadata?.priceToBeat ?? m.eventMetadata?.priceToBeat;
  const ptb = ptbRaw != null && !isNaN(+ptbRaw) ? +ptbRaw : null;
  return {
    slug: ev.slug,
    title: ev.title || m.question,
    upToken: tokens[iUp],
    downToken: tokens[iDown],
    ptb,
  };
}

export function winnerOf(ev) {
  const m = ev?.markets?.[0];
  if (!m) return null;
  const outs = toArr(m.outcomes);
  const pr = toArr(m.outcomePrices);
  if (!outs || !pr) return null;
  const settled = m.closed || m.umaResolutionStatus === "resolved";
  const i = pr.findIndex((p) => (settled ? +p >= 0.99 : +p >= 0.9995));
  if (i < 0) return null;
  return /^up/i.test(outs[i]) ? "Up" : "Down";
}

// Exact price to beat as Polymarket itself shows it (via our /api/ptb server route).
export async function fetchOpenPrice(windowStartSec) {
  try {
    const r = await fetch(`/api/ptb?start=${windowStartSec}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.openPrice === "number" ? j.openPrice : null;
  } catch {
    return null;
  }
}

// Fallback "price to beat" estimate: open of the 1-minute BTCUSDT candle at window start.
export async function fetchBinanceOpen(startMs) {
  const urls = [
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${startMs}&limit=1`,
    `https://api.binance.us/api/v3/klines?symbol=BTCUSD&interval=1m&startTime=${startMs}&limit=1`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j) && j[0]) return +j[0][1];
    } catch {}
  }
  return null;
}
