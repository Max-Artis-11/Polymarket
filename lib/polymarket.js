import { CLOB_REST, GAMMA } from "./config";

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
  return {
    slug: ev.slug,
    title: ev.title || m.question,
    upToken: tokens[iUp],
    downToken: tokens[iDown],
  };
}

// Gamma fills eventMetadata { priceToBeat, finalPrice } only AFTER a window ends.
export function metaOf(ev) {
  const md = ev?.eventMetadata || ev?.markets?.[0]?.eventMetadata || {};
  const num = (v) => (v != null && !isNaN(+v) ? +v : null);
  return { ptb: num(md.priceToBeat), final: num(md.finalPrice) };
}

export function outcomePrice(ev, side) {
  const m = ev?.markets?.[0];
  const outs = toArr(m?.outcomes);
  const pr = toArr(m?.outcomePrices);
  if (!outs || !pr) return null;
  const i = outs.findIndex((o) => (side === "Up" ? /^up/i : /^down/i).test(o));
  return i >= 0 && !isNaN(+pr[i]) ? +pr[i] : null;
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

// Live order book for any token (used to cash out ended markets). Bids sorted best-first.
export async function fetchBook(tokenId) {
  const parse = (j) => {
    const bids = (j?.bids || [])
      .map((l) => [+l.price, +l.size])
      .filter(([p, s]) => p > 0 && p < 1 && s > 0)
      .sort((a, b) => b[0] - a[0]);
    return { bids };
  };
  for (const u of [`${CLOB_REST}/book?token_id=${tokenId}`, `/api/book?token_id=${tokenId}`]) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) continue;
      return parse(await r.json());
    } catch {}
  }
  return null;
}
