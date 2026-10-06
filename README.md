# PolyPaper — Polymarket "Bitcoin Up or Down – 5 Minutes" paper trader

A 100% free, client-side paper trader that mimics Polymarket's BTC 5-minute Up/Down markets.
No backend, no database, no API keys, no sign-ups. Everything runs in the browser; Vercel only
serves the static app plus two tiny helper routes (`/api/time`, `/api/gamma`).

## What it does

- **Windows synced to real time**: markets are aligned to 5-minute boundaries in UTC epoch time
  (slug `btc-updown-5m-<unix start>`), displayed in **US Eastern Time** like Polymarket. Your clock is
  corrected against the server clock (`/api/time`) so the countdown rolls over on the exact boundary.
- **Live market data (free, public, no auth)**
  - Polymarket **Gamma API** → finds each window's market, token IDs and the exact **Price To Beat**
    (`eventMetadata.priceToBeat`, the same number Polymarket's page shows)
  - Polymarket **CLOB market WebSocket** → live order books
  - Polymarket **RTDS** WebSocket → live Chainlink BTC/USD. These markets resolve on Chainlink's **60-second
    TWAP** stream, so the app plots/displays the trailing 60s time-weighted average — the smooth line you see
    on Polymarket — not the jumpy raw spot price.
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
- **Price to beat** comes straight from Polymarket (Gamma). If it hasn't been published yet in the first
  seconds of a window, a small "≈ estimate" is shown (our own 60s TWAP at the window start) until it appears.
- The live price is computed locally from Polymarket's spot feed, so it can differ from Polymarket's by pennies
  to a couple of dollars. For the first ~minute after opening the app it borrows 1-second Binance candles
  (aligned to the live feed) so the 60s average is correct immediately.
- **Chart**: rolling 60-second window with the live price pinned at the right edge; the head eases toward each
  new tick so it glides. Use the top-left button to switch light/dark.
- Settlement uses Polymarket's real result.
- Trading fees are ignored by default. Set `TAKER_FEE_RATE` in `lib/config.js` to simulate one.
- Polymarket's public endpoints can change; if something stops updating, check `lib/config.js`.

## Tweaks

All knobs live in `lib/config.js` (start balance, fill delay, fee, endpoints).
