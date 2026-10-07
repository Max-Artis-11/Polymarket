"use client";
import { useEffect, useRef } from "react";
import { CHART_SECONDS } from "../lib/config";

// Polymarket-style live chart:
//  - one point per second (the 60s TWAP), straight segments, live dot pinned at the right
//  - the head glides between per-second points at real-time speed, so the line scrolls
//    calmly the way Polymarket's does instead of twitching on every raw tick
//  - tight, eased y-scale; dashed "Target" line with an edge pill when off-scale

const ORANGE = "#f7931a";
const PAL = {
  dark: { grid: "rgba(255,255,255,0.07)", label: "#7d8b9b", ptb: "rgba(190,200,212,0.5)", tagBg: "#3a4756", tagText: "#e6edf5", fillTop: "rgba(247,147,26,0.16)" },
  light: { grid: "rgba(0,0,0,0.07)", label: "#86919d", ptb: "rgba(60,72,88,0.45)", tagBg: "#8b95a1", tagText: "#ffffff", fillTop: "rgba(247,147,26,0.10)" },
};
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function niceStep(span, n) {
  const raw = Math.max(span, 1e-6) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export default function Chart({ getSeries, ptb, theme }) {
  const ref = useRef(null);
  const props = useRef({});
  props.current = { getSeries, ptb, theme };

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    let raf;
    let w = 0;
    let h = 0;
    let vt = null; // virtual "now" of the chart head (ms)
    let lastPerf = 0;
    let lo = null;
    let hi = null;

    const resize = () => {
      const r = cv.parentElement.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      cv.width = w * d;
      cv.height = h * d;
      cv.style.width = w + "px";
      cv.style.height = h + "px";
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv.parentElement);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { getSeries, ptb, theme } = props.current;
      const P = PAL[theme] || PAL.dark;
      const perf = performance.now();
      const dt = lastPerf ? Math.min(100, perf - lastPerf) : 0;
      lastPerf = perf;

      ctx.clearRect(0, 0, w, h);
      const L = 4, R = 70, T = 12, B = 28;
      const pw = w - L - R;
      const ph = h - T - B;
      if (pw < 80 || ph < 60) return;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";

      const arr = getSeries();
      const n = arr.length;
      if (!n) {
        vt = null;
        ctx.fillStyle = P.label;
        ctx.textAlign = "center";
        ctx.fillText("Connecting to live price…", L + pw / 2, T + ph / 2);
        return;
      }

      // ---- advance the head at real-time speed toward the newest second ----
      const newest = arr[n - 1][0];
      if (vt == null || vt > newest || newest - vt > 3000) vt = vt == null || vt > newest ? newest : newest - 1000;
      else vt = Math.min(newest, vt + dt * (newest - vt > 1500 ? 1.5 : 1));

      // head value (interpolated between the two seconds around vt)
      let j = n - 1;
      while (j > 0 && arr[j][0] > vt) j--;
      let headV = arr[j][1];
      if (j < n - 1 && arr[j + 1][0] > arr[j][0]) {
        const f = (vt - arr[j][0]) / (arr[j + 1][0] - arr[j][0]);
        headV = arr[j][1] + (arr[j + 1][1] - arr[j][1]) * Math.max(0, Math.min(1, f));
      }

      const span = CHART_SECONDS * 1000;
      const tMin = vt - span;
      const xHead = L + pw - 16;
      const x = (t) => xHead - ((vt - t) / span) * (xHead - L);

      // ---- y range ----
      let mn = headV;
      let mx = headV;
      let first = j;
      while (first > 0 && arr[first][0] > tMin - 1000) first--;
      for (let i = first; i <= j; i++) {
        const v = arr[i][1];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const sp = Math.max(mx - mn, 8);
      const pad = sp * 0.22;
      const mid = (mx + mn) / 2;
      const tlo = mid - sp / 2 - pad;
      const thi = mid + sp / 2 + pad;
      if (lo == null) { lo = tlo; hi = thi; }
      else {
        const k = 1 - Math.exp(-dt / 260);
        lo += (tlo - lo) * k;
        hi += (thi - hi) * k;
      }
      const y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;

      // ---- grid + right axis ----
      const step = niceStep(hi - lo, 4);
      ctx.lineWidth = 1;
      ctx.textAlign = "left";
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const yy = Math.round(y(v)) + 0.5;
        ctx.strokeStyle = P.grid;
        ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
        ctx.fillStyle = P.label;
        ctx.fillText("$" + v.toLocaleString("en-US", { maximumFractionDigits: step < 1 ? 2 : 0 }), L + pw + 8, yy);
      }

      // ---- time labels (ride along with the points) ----
      const lstep = pw < 520 ? 20000 : 10000;
      ctx.textAlign = "center";
      ctx.fillStyle = P.label;
      for (let i = first; i <= j; i++) {
        const t = arr[i][0];
        if (t % lstep !== 0) continue;
        const xx = x(t);
        if (xx < L + 36 || xx > xHead - 30) continue;
        ctx.fillText(timeFmt.format(t), xx, h - 12);
      }

      // ---- target (price to beat) ----
      if (ptb != null) {
        let yy = y(ptb);
        let dir = 0;
        if (yy < T + 9) { yy = T + 9; dir = -1; }
        else if (yy > T + ph - 9) { yy = T + ph - 9; dir = 1; }
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = P.ptb;
        ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
        ctx.setLineDash([]);
        const tw = R - 8;
        ctx.fillStyle = P.tagBg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(L + pw + 4, yy - 9, tw, 18, 5);
        else ctx.rect(L + pw + 4, yy - 9, tw, 18);
        ctx.fill();
        ctx.fillStyle = P.tagText;
        ctx.textAlign = "center";
        ctx.fillText("Target" + (dir > 0 ? " ⌄" : dir < 0 ? " ⌃" : ""), L + pw + 4 + tw / 2, yy + (dir ? 1 : 0));
      }

      // ---- the line ----
      const pts = [];
      for (let i = first; i <= j; i++) pts.push([x(arr[i][0]), y(arr[i][1])]);
      const hx = xHead;
      const hy = y(headV);
      pts.push([hx, hy]);

      if (pts.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(L, T - 4, pw + 2, ph + 8);
        ctx.clip();

        const g = ctx.createLinearGradient(0, T, 0, T + ph);
        g.addColorStop(0, P.fillTop);
        g.addColorStop(1, "rgba(247,147,26,0)");
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.lineTo(hx, T + ph);
        ctx.lineTo(pts[0][0], T + ph);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = ORANGE;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
      }

      // ---- head: dot + ring + soft pulse ----
      const pulse = (perf % 1600) / 1600;
      ctx.strokeStyle = `rgba(247,147,26,${0.45 * (1 - pulse)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, hy, 6 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(247,147,26,0.7)";
      ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fill();
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="chart" />;
}
