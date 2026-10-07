export const fmtUsd = (n) => `$${(n ?? 0).toFixed(2)}`;
export const fmtPnl = (n) => `${n >= 0 ? "+" : "-"}$${Math.abs(n ?? 0).toFixed(2)}`;
export const money = (n) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 0.09 -> "9¢", 0.995 -> "99.5¢"
export const cents = (p) => {
  if (p == null || isNaN(p)) return "—";
  const c = p * 100;
  return Math.abs(c - Math.round(c)) < 1e-6 ? `${Math.round(c)}¢` : `${c.toFixed(1)}¢`;
};

const et = (d, o) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o }).format(d);

// "October 7, 2-2:05AM ET" / "October 6, 2:10-2:15PM ET" (Polymarket's format, Eastern Time)
export function fmtWindow(startMs, withDate = true) {
  const s = new Date(startMs);
  const e = new Date(startMs + 300000);
  const [h1, m1] = et(s, { hour: "numeric", minute: "2-digit" }).split(/\s+/);
  const [h2, m2] = et(e, { hour: "numeric", minute: "2-digit" }).split(/\s+/);
  const a = h1.replace(":00", "") + (m1 === m2 ? "" : m1);
  const b = h2.replace(":00", "") + m2;
  const date = et(s, { month: "long", day: "numeric" });
  return `${withDate ? date + ", " : ""}${a}-${b} ET`;
}

// "2:05 AM"
export const fmtClockET = (ms) => et(new Date(ms), { hour: "numeric", minute: "2-digit" });
