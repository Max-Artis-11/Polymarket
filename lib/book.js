"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLOB_REST, CLOB_WS } from "./config";

const EMPTY = { Up: { bid: null, ask: null }, Down: { bid: null, ask: null } };

// Live order books for the Up and Down tokens via Polymarket's public market WebSocket
// (no auth). REST /book is used to seed and as a fallback if the socket goes quiet.
export function usePolyBook(upToken, downToken) {
  const books = useRef({});
  const lastWs = useRef(0);
  const dirty = useRef(true);
  const tokens = useRef({});
  tokens.current = { up: upToken, down: downToken };
  const [quotes, setQuotes] = useState(EMPTY);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    books.current = {};
    lastWs.current = 0;
    dirty.current = true;
    setQuotes(EMPTY);
    setConnected(false);
    if (!upToken || !downToken) return;

    let dead = false;
    let ws;
    let ping;
    let retry;

    const ensure = (id) => books.current[id] || (books.current[id] = { bids: new Map(), asks: new Map() });
    const setBook = (id, bids, asks) => {
      const b = ensure(id);
      b.bids = new Map();
      b.asks = new Map();
      for (const l of bids || []) if (+l.size > 0) b.bids.set(l.price, +l.size);
      for (const l of asks || []) if (+l.size > 0) b.asks.set(l.price, +l.size);
      dirty.current = true;
    };

    const onMsg = (m) => {
      if (!m || typeof m !== "object") return;
      if (Array.isArray(m)) return m.forEach(onMsg);
      if (m.event_type === "book") {
        setBook(m.asset_id, m.bids, m.asks);
        lastWs.current = Date.now();
      } else if (m.event_type === "price_change") {
        for (const c of m.price_changes || []) {
          const b = ensure(c.asset_id);
          const map = c.side === "BUY" ? b.bids : b.asks;
          if (+c.size > 0) map.set(c.price, +c.size);
          else map.delete(c.price);
        }
        dirty.current = true;
        lastWs.current = Date.now();
      }
    };

    const connect = () => {
      if (dead) return;
      ws = new WebSocket(CLOB_WS);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "market", assets_ids: [upToken, downToken] }));
        ping = setInterval(() => { try { ws.send("PING"); } catch {} }, 10000);
      };
      ws.onmessage = (e) => {
        if (e.data === "PONG") return;
        try { onMsg(JSON.parse(e.data)); } catch {}
        setConnected(true);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        clearInterval(ping);
        setConnected(false);
        if (!dead) retry = setTimeout(connect, 1000);
      };
    };

    const poll = async () => {
      if (Date.now() - lastWs.current < 4000) return;
      for (const id of [upToken, downToken]) {
        try {
          const r = await fetch(`${CLOB_REST}/book?token_id=${id}`, { cache: "no-store" });
          const j = await r.json();
          if (!dead && Date.now() - lastWs.current >= 4000) setBook(id, j.bids, j.asks);
        } catch {}
      }
    };

    const best = (id) => {
      const b = books.current[id];
      if (!b) return { bid: null, ask: null };
      let bid = null;
      let ask = null;
      for (const k of b.bids.keys()) { const p = +k; if (bid == null || p > bid) bid = p; }
      for (const k of b.asks.keys()) { const p = +k; if (ask == null || p < ask) ask = p; }
      return { bid, ask };
    };

    connect();
    poll();
    const pid = setInterval(poll, 3000);
    const qid = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      setQuotes({ Up: best(upToken), Down: best(downToken) });
    }, 120);

    return () => {
      dead = true;
      clearTimeout(retry);
      clearInterval(ping);
      clearInterval(pid);
      clearInterval(qid);
      try { ws && ws.close(); } catch {}
    };
  }, [upToken, downToken]);

  const getBook = useCallback((side) => {
    const id = side === "Up" ? tokens.current.up : tokens.current.down;
    const b = books.current[id];
    if (!b) return { asks: [], bids: [] };
    const asks = [...b.asks].map(([p, s]) => [+p, s]).filter(([p]) => p > 0 && p < 1).sort((x, y) => x[0] - y[0]);
    const bids = [...b.bids].map(([p, s]) => [+p, s]).filter(([p]) => p > 0 && p < 1).sort((x, y) => y[0] - x[0]);
    return { asks, bids };
  }, []);

  return { quotes, getBook, connected };
}
