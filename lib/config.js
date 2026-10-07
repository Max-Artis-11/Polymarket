// ---- Tweak these if you like ----
export const WINDOW_SEC = 300;            // 5-minute markets
export const FILL_DELAY_MS = 250;         // mimics Polymarket's taker delay
export const DEFAULT_BALANCE = 200;       // starting paper cash
export const MIN_ORDER_USD = 1;           // Polymarket min marketable order
export const TAKER_FEE_RATE = 0;          // set e.g. 0.01 for a flat 1% paper fee
export const ONE_TAP_AMOUNTS = [5, 25, 100];

// Price engine. Polymarket's "Price To Beat" and "Current Price" are Chainlink's
// 60-second TWAP (time-weighted average), sampled once per second.
export const TWAP_MS = 60000;
export const PRICE_LAG_MS = 0;            // extra delay before a second is "printed" (raise if we feel ahead of Polymarket)

// Chart
export const CHART_SECONDS = 60;          // how much history is visible
export const EMBED_REFRESH_MS = 30000;    // how often the Polymarket embed silently reloads

// ---- Free, public, no-signup endpoints ----
export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB_REST = "https://clob.polymarket.com"; // public read-only /book
export const CLOB_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"; // public market channel
export const RTDS_WS = "wss://ws-live-data.polymarket.com"; // public Chainlink BTC/USD feed
