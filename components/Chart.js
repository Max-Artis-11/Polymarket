"use client";
import { useEffect, useRef } from "react";
import { fmtClockET } from "../lib/format";

const GREEN = "#2fc27a";
const RED = "#ef4b5b";

export default function Chart({ getSeries, getNow, startMs, endMs, ptb }) {
  const ref = useRef(null);
  const props = useRef({});
  props.current = { getSeries, getNow, startMs, endMs, ptb };

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    let raf;
    let w = 0;
    let h = 0;
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
      const { getSeries, startMs, endMs, ptb } = props.current;
      ctx.clearRect(0, 0, w, h);
      const L = 8, R = 70, T = 14, B = 26;
      const pw = w - L - R;
      const ph = h - T - B;
      if (pw < 50 || ph < 50) return;

      const arr = getSeries().arr;
      const pts = [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i][0];
        if (t < startMs - 1000) break;
        if (t <= endMs + 500) pts.push(arr[i]);
      }
      pts.reverse();

      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";

      if (!pts.length) {
        ctx.fillStyle = "#8a98a8";
        ctx.textAlign = "center";
        ctx.fillText("Waiting for live price…", w / 2, h / 2);
        return;
      }

      let mn = Infinity;
      let mx = -Infinity;
      for (const [, p] of pts) { if (p < mn) mn = p; if (p > mx) mx = p; }
      if (ptb != null) { if (ptb < mn) mn = ptb; if (ptb > mx) mx = ptb; }
      const span = Math.max(mx - mn, 20);
      const pad = span * 0.22;
      const mid = (mx + mn) / 2;
      const tlo = mid - span / 2 - pad;
      const thi = mid + span / 2 + pad;
      if (lo == null) { lo = tlo; hi = thi; }
      else { lo += (tlo - lo) * 0.1; hi += (thi - hi) * 0.1; }

      const x = (t) => L + ((t - startMs) / (endMs - startMs)) * pw;
      const y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;

      // horizontal grid + right-axis labels
      ctx.lineWidth = 1;
      ctx.textAlign = "left";
      for (let i = 0; i <= 4; i++) {
        const v = lo + ((hi - lo) * i) / 4;
        const yy = y(v);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
        ctx.fillStyle = "#6f7d8d";
        ctx.fillText("$" + v.toLocaleString("en-US", { maximumFractionDigits: hi - lo > 60 ? 0 : 1 }), L + pw + 8, yy);
      }

      // vertical minute lines + ET labels
      ctx.textAlign = "center";
      for (let k = 0; k <= 5; k++) {
        const tt = startMs + k * 60000;
        const xx = x(tt);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.beginPath(); ctx.moveTo(xx, T); ctx.lineTo(xx, T + ph); ctx.stroke();
        ctx.fillStyle = "#6f7d8d";
        ctx.fillText(fmtClockET(tt), Math.min(Math.max(xx, L + 18), L + pw - 18), h - 10);
      }

      // price to beat
      if (ptb != null) {
        const yy = y(ptb);
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "rgba(180,192,206,0.55)";
        ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#b4c0ce";
        ctx.textAlign = "left";
        ctx.fillText("beat", L + pw + 8, yy - 11);
      }

      // price line
      const last = pts[pts.length - 1];
      const up = ptb == null ? true : last[1] >= ptb;
      const col = up ? GREEN : RED;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach(([t, p], i) => {
        const xx = x(Math.min(t, endMs));
        if (i === 0) ctx.moveTo(xx, y(p)); else ctx.lineTo(xx, y(p));
      });
      ctx.stroke();

      // live dot with pulse
      const lx = x(Math.min(last[0], endMs));
      const ly = y(last[1]);
      const pulse = (Math.sin(performance.now() / 300) + 1) / 2;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.25 * (1 - pulse);
      ctx.beginPath(); ctx.arc(lx, ly, 6 + pulse * 8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();

      // price tag on the axis
      const label = "$" + last[1].toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      ctx.fillStyle = col;
      ctx.fillRect(L + pw + 2, ly - 10, R - 4, 20);
      ctx.fillStyle = "#07120c";
      ctx.textAlign = "center";
      ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, L + pw + 2 + (R - 4) / 2, ly);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="chart" />;
}
