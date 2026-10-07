"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EMBED_REFRESH_MS } from "../lib/config";

// Polymarket's official embed, always locked to the LIVE window.
// It re-points itself the moment a new window starts and silently reloads every
// EMBED_REFRESH_MS so it never sits on a stale market. Two stacked iframes are used
// so the old one stays visible until the new one has finished loading (no flicker).
export default function Embed({ slug, windowLabel, theme }) {
  const base = `https://embed.polymarket.com/market?market=${slug}&height=300&theme=${theme}`;
  const [frames, setFrames] = useState([]);
  const n = useRef(0);

  const reload = useCallback(() => {
    const id = ++n.current;
    setFrames((f) => [...f.filter((x) => x.loaded).slice(-1), { id, src: `${base}&r=${id}`, loaded: false }]);
  }, [base]);

  // new window (or theme): load immediately, then again a moment later in case
  // Polymarket's embed hadn't switched the new market live yet
  useEffect(() => {
    reload();
    const t = setTimeout(reload, 4000);
    const i = setInterval(reload, EMBED_REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [reload]);

  const onLoad = (id) =>
    setFrames((f) => {
      const me = f.find((x) => x.id === id);
      if (!me) return f;
      // keep only the newest loaded frame (plus any newer one still loading)
      return f.filter((x) => x.id >= id).map((x) => (x.id === id ? { ...x, loaded: true } : x));
    });

  return (
    <section className="embed card">
      <div className="etitle">
        <span>
          Polymarket live widget <span className="mute">· {windowLabel}</span>
        </span>
        <span className="elinks">
          <button className="linkbtn" onClick={reload}>↻ Refresh</button>
          <a href={`https://polymarket.com/event/${slug}`} target="_blank" rel="noopener noreferrer">
            Open on Polymarket ↗
          </a>
        </span>
      </div>
      <div className="eframe">
        {frames.map((f) => (
          <iframe
            key={f.id}
            title={`Polymarket ${slug}`}
            src={f.src}
            width="400"
            height="300"
            frameBorder="0"
            allowTransparency="true"
            onLoad={() => onLoad(f.id)}
            style={{ opacity: f.loaded ? 1 : 0, zIndex: f.loaded ? 1 : 2, pointerEvents: f.loaded ? "auto" : "none" }}
          />
        ))}
      </div>
    </section>
  );
}
