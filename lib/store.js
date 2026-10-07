import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_BALANCE } from "./config";

const uid = () => Math.random().toString(36).slice(2, 10);

export const useStore = create(
  persist(
    (set) => ({
      balance: DEFAULT_BALANCE,
      startBalance: DEFAULT_BALANCE,
      positions: [],
      history: [],

      reset: (amt) => set({ balance: amt, startBalance: amt, positions: [], history: [] }),

      applyBuy: (o) =>
        set((s) => {
          const positions = [...s.positions];
          const i = positions.findIndex((p) => p.slug === o.slug && p.side === o.side);
          if (i >= 0) {
            positions[i] = {
              ...positions[i],
              shares: positions[i].shares + o.shares,
              cost: positions[i].cost + o.cost,
              tokenId: positions[i].tokenId || o.tokenId,
            };
          } else {
            positions.push({
              id: uid(),
              slug: o.slug,
              windowStart: o.windowStart,
              endMs: o.endMs,
              side: o.side,
              tokenId: o.tokenId || null,
              shares: o.shares,
              cost: o.cost,
            });
          }
          return {
            balance: s.balance - o.cost,
            positions,
            history: [
              {
                id: uid(), ts: Date.now(), type: "BUY", slug: o.slug, windowStart: o.windowStart,
                side: o.side, shares: o.shares, price: o.cost / o.shares, amount: o.cost,
              },
              ...s.history,
            ].slice(0, 300),
          };
        }),

      applySell: (o) =>
        set((s) => {
          const positions = [];
          let costBasis = 0;
          for (const p of s.positions) {
            if (p.slug === o.slug && p.side === o.side) {
              const frac = Math.min(1, o.shares / p.shares);
              costBasis = p.cost * frac;
              const left = p.shares - o.shares;
              if (left > 1e-6) positions.push({ ...p, shares: left, cost: p.cost - costBasis });
            } else positions.push(p);
          }
          return {
            balance: s.balance + o.proceeds,
            positions,
            history: [
              {
                id: uid(), ts: Date.now(), type: o.label || "SELL", slug: o.slug, windowStart: o.windowStart,
                side: o.side, shares: o.shares, price: o.proceeds / o.shares, amount: o.proceeds,
                pnl: o.proceeds - costBasis,
              },
              ...s.history,
            ].slice(0, 300),
          };
        }),

      settle: (slug, winner) =>
        set((s) => {
          const hit = s.positions.filter((p) => p.slug === slug);
          if (!hit.length) return s;
          let bal = s.balance;
          const entries = hit.map((p) => {
            const payout = p.side === winner ? p.shares : 0;
            bal += payout;
            return {
              id: uid(), ts: Date.now(), type: "SETTLE", slug, windowStart: p.windowStart, side: p.side,
              shares: p.shares, price: payout ? 1 : 0, amount: payout, pnl: payout - p.cost, winner,
            };
          });
          return {
            balance: bal,
            positions: s.positions.filter((p) => p.slug !== slug),
            history: [...entries, ...s.history].slice(0, 300),
          };
        }),
    }),
    { name: "polypaper-btc5m-v1" }
  )
);
