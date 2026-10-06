"use client";
import { useEffect, useRef } from "react";

// Polymarket-style live chart:
//  - rolling ~60s window, the live price is ALWAYS pinned at the right edge
//  - the head is eased toward each new tick so it glides instead of jumping
//  - tight auto y-scale that eases smoothly, no vertical wobble
//  - dashed "Target" (price to beat) line, clamped to the edge with a pill when off-scale

const WINDOW_MS = 60000;
const ORANGE = "#f7931a";

const PAL = {
  dark: { grid: "rgba(255,255,255,0.07)", label: "#7d8b9b", ptb: "rgba(190,200,212,0.55)", tagBg: "#3a4756", tagText: "#e6edf5" },
  light: { grid: "rgba(0,0,0,0.07)", label: "#86919d", ptb: "rgba(60,72,88,0.5)", tagBg: "#8b95a1", tagText: "#ffffff" },
};

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function niceStep(span, n) {
  const raw = Math.max(span, 1e-6) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export default function Chart({ getSeries, getNow, ptb, theme }) {
  const ref = useRef(null);
  const props = useRef({});
  props.current = { getSeries, getNow, ptb, theme };

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    let raf;
    let w = 0;
    let h = 0;
    let disp = []; // eased display series [t, v]
    let head = null;
    let lastT = 0;
    let lo = null;
    let hi = null;
    let srcName = null;

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
      const { getSeries, getNow, ptb, theme } = props.current;
      const P = PAL[theme] || PAL.dark;
      const now = getNow();
      const { arr, name } = getSeries();

      if (name !== srcName) {
        srcName = name;
        disp = [];
        head = null;
        lo = hi = null;
        lastT = 0;
      }

      ctx.clearRect(0, 0, w, h);
      const L = 4, R = 68, T = 10, B = 28;
      const pw = w - L - R;
      const ph = h - T - B;
      if (pw < 80 || ph < 60) return;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";

      const rawLast = arr[arr.length - 1];
      if (!rawLast) {
        ctx.fillStyle = P.label;
        ctx.textAlign = "center";
        ctx.fillText("Waiting for live price…", L + pw / 2, T + ph / 2);
        return;
      }

      // ---- advance the eased display series ----
      const dt = lastT ? Math.min(250, Math.max(0, now - lastT)) : 0;
      lastT = now;
      const lastD = disp[disp.length - 1];
      if (!lastD || now - lastD[0] > 2500) {
        // (re)seed from real ticks so the chart isn't empty on load / after tab was hidden
        disp = [];
        for (let i = arr.length - 1; i >= 0 && arr[i][0] >= now - WINDOW_MS - 3000; i--) {
          if (arr[i][0] <= now) disp.push([arr[i][0], arr[i][1]]);
        }
        disp.reverse();
        head = disp.length ? disp[disp.length - 1][1] : rawLast[1];
        disp.push([now, head]);
      }
      head += (rawLast[1] - head) * (1 - Math.exp(-dt / 140));
      if (now - disp[disp.length - 1][0] >= 40) disp.push([now, head]);
      const cutT = now - WINDOW_MS - 4000;
      let k = 0;
      while (k < disp.length - 2 && disp[k + 1][0] < cutT) k++;
      if (k > 0) disp.splice(0, k);

      // ---- y range: tight, eased ----
      const tMin = now - WINDOW_MS;
      let mn = head;
      let mx = head;
      for (let i = disp.length - 1; i >= 0; i--) {
        if (disp[i][0] < tMin) break;
        const v = disp[i][1];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const span = Math.max(mx - mn, 10);
      const pad = span * 0.2;
      const mid = (mx + mn) / 2;
      const tlo = mid - span / 2 - pad;
      const thi = mid + span / 2 + pad;
      if (lo == null) { lo = tlo; hi = thi; }
      else {
        const kk = 1 - Math.exp(-dt / 220);
        lo += (tlo - lo) * kk;
        hi += (thi - hi) * kk;
      }

      const xHead = L + pw - 14;
      const pxPerMs = (xHead - L) / WINDOW_MS;
      const x = (t) => xHead - (now - t) * pxPerMs;
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

      // ---- time axis (scrolls with the line) ----
      const tstep = pw < 520 ? 20000 : 10000;
      ctx.textAlign = "center";
      ctx.fillStyle = P.label;
      for (let t = Math.ceil(tMin / tstep) * tstep; t <= now; t += tstep) {
        const xx = x(t);
        if (xx < L + 40 || xx > xHead - 12) continue;
        ctx.fillText(timeFmt.format(t), xx, h - 12);
      }

      // ---- target (price to beat) ----
      if (ptb != null) {
        let yy = y(ptb);
        let dir = 0;
        if (yy < T + 8) { yy = T + 8; dir = -1; }
        else if (yy > T + ph - 8) { yy = T + ph - 8; dir = 1; }
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = P.ptb;
        ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
        ctx.setLineDash([]);
        const tw = R - 10;
        ctx.fillStyle = P.tagBg;
        ctx.beginPath();
        ctx.roundRect(L + pw + 4, yy - 9, tw, 18, 5);
        ctx.fill();
        ctx.fillStyle = P.tagText;
        ctx.textAlign = "center";
        ctx.fillText("Target" + (dir > 0 ? " ▾" : dir < 0 ? " ▴" : ""), L + pw + 4 + tw / 2, yy);
      }

      // ---- the line (smoothed) ----
      const pts = [];
      for (let i = 0; i < disp.length; i++) {
        if (disp[i][0] < tMin - 2000) continue;
        pts.push([x(disp[i][0]), y(disp[i][1])]);
      }
      const hx = xHead;
      const hy = y(head);
      if (pts.length && pts[pts.length - 1][0] < hx) pts.push([hx, hy]);

      if (pts.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(L, T, pw + 2, ph);
        ctx.clip();

        const path = () => {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length - 1; i++) {
            const mx2 = (pts[i][0] + pts[i + 1][0]) / 2;
            const my2 = (pts[i][1] + pts[i + 1][1]) / 2;
            ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx2, my2);
          }
          ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        };

        // soft area fill
        const g = ctx.createLinearGradient(0, T, 0, T + ph);
        g.addColorStop(0, "rgba(247,147,26,0.20)");
        g.addColorStop(1, "rgba(247,147,26,0)");
        ctx.beginPath();
        path();
        ctx.lineTo(pts[pts.length - 1][0], T + ph);
        ctx.lineTo(pts[0][0], T + ph);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();

        ctx.beginPath();
        path();
        ctx.strokeStyle = ORANGE;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
      }

      // ---- head dot with pulsing ring ----
      const pulse = (Math.sin(now / 350) + 1) / 2;
      ctx.strokeStyle = `rgba(247,147,26,${0.55 * (1 - pulse)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, hy, 7 + pulse * 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="chart" />;
}
