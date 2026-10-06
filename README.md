# PolyPaper — Polymarket "Bitcoin Up or Down – 5 Minutes" paper trader

A 100% free, client-side paper trader that mimics Polymarket's BTC 5-minute Up/Down markets.
No backend, no database, no API keys, no sign-ups. Everything runs in the browser; Vercel only
serves the static app plus two tiny helper routes (`/api/time`, `/api/gamma`).

## What it does

- **Windows synced to real time**: markets are aligned to 5-minute boundaries in UTC epoch time
  (slug `btc-updown-5m-<unix start>`), displayed in **US Eastern Time** like Polymarket. Your clock is
  corrected against the server clock (`/api/time`) so the countdown rolls over on the exact boundary.
- **Live market data (free, public, no auth)**
  - Polymarket **Gamma API** → finds each window's market + token IDs
  - Polymarket **CLOB market WebSocket** (`wss://ws-subscriptions-clob.polymarket.com/ws/market`) → live order books
  - Polymarket **RTDS** WebSocket → Chainlink BTC/USD, the price source Polymarket resolves on
  - **Binance** WebSocket → sub-second BTC ticks (auto-falls back to Binance.US, then Coinbase, if blocked in your region)
- **Paper engine in your browser** (Zustand + localStorage): starts with **$200** (Reset → $200, random, or custom).
  Orders wait **250 ms**, then fill by walking the live order book (real VWAP/slippage).
- **Settlement**: after a window ends, positions are settled from Polymarket's actual resolved outcome
  (Gamma API). Winning shares pay $1, losing pay $0.
- Canvas price chart, price-to-beat line, 5-min countdown, trade ticket, open positions + history drawer.

## Deploy (free)

1. Create a new GitHub repo and drag in **all files/folders from this project** (not the zip itself).
2. On vercel.com → *Add New → Project* → import the repo → Deploy. No env vars needed.

Run locally: `npm install && npm run dev` → http://localhost:3000

## Notes / honest caveats

- Paper trading only. Not affiliated with Polymarket.
- "Price to beat" uses Polymarket's value if the API exposes it, otherwise the Chainlink tick at window
  start, otherwise the Binance 1-minute candle open (marked ≈). If you open the app mid-window, it may be approximate.
- The Binance feed is faster than Chainlink and can differ by a few dollars; settlement uses Polymarket's result.
- Trading fees are ignored by default. Set `TAKER_FEE_RATE` in `lib/config.js` to simulate one.
- Polymarket's public endpoints can change; if something stops updating, check `lib/config.js`.

## Tweaks

All knobs live in `lib/config.js` (start balance, fill delay, fee, endpoints).
