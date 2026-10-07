# PolyPaper: Polymarket "BTC Up or Down 5m" paper trader

A free, client-side paper trader that mirrors Polymarket's Bitcoin Up or Down 5-minute markets.
No backend, database, API keys or sign-ups. Everything runs in the browser; Vercel only serves the
app plus three tiny helper routes (`/api/time`, `/api/gamma`, `/api/book`).

## How it matches Polymarket

- **Windows** align to 5-minute boundaries (slug `btc-updown-5m-<unix start>`), shown in **US Eastern
  Time** like Polymarket. Your clock is corrected against the server (`/api/time`).
- **Price To Beat / Current Price**: these markets resolve on Chainlink's **60-second TWAP** stream.
  - Price To Beat of a window = TWAP at the window's start (= the previous window's final price).
  - Polymarket's TWAP feed needs API credentials, so the app rebuilds the same TWAP from Polymarket's
    **public** live Chainlink BTC/USD feed and samples it once per second, like Polymarket does.
  - It's exact once the app has watched a full minute of live data before the window starts. If you open
    the app mid-window it shows "≈ estimate" for that window only, then it's exact from the next window on.
    Recent data is kept in your browser, so a quick reload keeps it exact.
  - Gamma (Polymarket's API) publishes the official numbers only after a window ends; the app pulls them in
    to confirm past results.
- **Chart**: one point per second, straight segments, live dot pinned at the right. It scrolls at real-time
  speed with the dashed Target line, and live trades from the order book appear bottom-left (+$X, green Up,
  red Down).
- **Order books**: Polymarket's public CLOB WebSocket (no auth). Fills walk the real book after a
  **250 ms** delay (real slippage).
- **Ticket**: Buy/Sell, Up/Down, **1-Tap** ($5 / $25 / $100 with "win $X") or **Amount** mode.
- **Past row**: last 4 results (▲/▼) and window buttons like Polymarket's.
- **Sell Now Anyway**: once a window ends, its result is already decided but Polymarket takes a few
  minutes to resolve it. This button sells your shares straight away into that market's real order
  book (which keeps trading at ~99.9¢ / ~0.1¢), so you don't have to wait.
- **Auto-settlement** when Polymarket resolves: winning shares pay $1, losing pay $0.
- **Embed**: Polymarket's official widget below everything. It always follows the live window, switches
  the moment a new one starts, and reloads itself every 30 s without flicker.
- Light/dark toggle top-left. Paper account starts at **$200** (Reset: $200, random, or custom).

## Deploy (free)

1. Create a GitHub repo and drag in **all the files/folders from this project** (not the zip itself).
2. vercel.com → *Add New → Project* → import the repo → Deploy. No env vars needed.

Run locally: `npm install && npm run dev` → http://localhost:3000

## Tweaks (`lib/config.js`)

- `DEFAULT_BALANCE`, `FILL_DELAY_MS`, `TAKER_FEE_RATE`, `ONE_TAP_AMOUNTS`
- `PRICE_LAG_MS`: raise it (e.g. 1000) if the price ever looks a beat ahead of Polymarket's
- `CHART_SECONDS`: how much history the chart shows
- `EMBED_REFRESH_MS`: how often the embed reloads

## Notes

- Paper trading only. Not affiliated with Polymarket.
- The "≈ estimate" fallback borrows 1-second Binance candles (shifted onto the Chainlink level) for the
  minute you missed.
- Polymarket's public endpoints can change; if something stops updating, check `lib/config.js`.
