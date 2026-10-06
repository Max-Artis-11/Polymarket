export const fmtUsd = (n) => `$${(n ?? 0).toFixed(2)}`;
export const fmtPnl = (n) => `${n >= 0 ? "+" : "-"}$${Math.abs(n ?? 0).toFixed(2)}`;
export const cents = (p) => (p == null ? "—" : `${(p * 100).toFixed(p * 100 < 10 ? 1 : 0)}¢`);

const et = (d, o) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o }).format(d);

// "October 6, 2:10-2:15PM ET" (Polymarket shows these windows in Eastern Time)
export function fmtWindow(startMs, withDate = true) {
  const s = new Date(startMs);
  const e = new Date(startMs + 300000);
  const t1 = et(s, { hour: "numeric", minute: "2-digit" });
  const t2 = et(e, { hour: "numeric", minute: "2-digit" });
  const m1 = t1.slice(-2);
  const m2 = t2.slice(-2);
  const a = m1 === m2 ? t1.replace(/\s?[AP]M/, "") : t1.replace(" ", "");
  const b = t2.replace(" ", "");
  const date = et(s, { month: "long", day: "numeric" });
  return `${withDate ? date + ", " : ""}${a}-${b} ET`;
}

export const fmtClockET = (ms) => et(new Date(ms), { hour: "numeric", minute: "2-digit" });
