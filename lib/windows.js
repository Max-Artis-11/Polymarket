// Per-window facts kept in localStorage: { [windowStartSec]: { ptb, ptbExact, final, finalExact, gWinner } }
const KEY = "polypaper-windows-v1";
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    cache = {};
  }
  return cache;
}

export function getWin(ws) {
  return load()[ws] || null;
}

export function setWin(ws, patch) {
  const c = load();
  c[ws] = { ...(c[ws] || {}), ...patch };
  const cut = Math.floor(Date.now() / 1000) - 2 * 86400;
  for (const k of Object.keys(c)) if (+k < cut) delete c[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
  return c[ws];
}

// Up wins if the final price is >= the price to beat.
export function resultOf(ws) {
  const c = getWin(ws);
  if (!c) return null;
  if (c.gWinner) return { winner: c.gWinner, official: true };
  if (c.ptb != null && c.final != null) return { winner: c.final >= c.ptb ? "Up" : "Down", official: false };
  return null;
}
