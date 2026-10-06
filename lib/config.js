// ---- Tweak these if you like ----
export const WINDOW_SEC = 300;            // 5-minute markets
export const FILL_DELAY_MS = 250;         // mimics Polymarket's taker delay
export const DEFAULT_BALANCE = 200;       // starting paper cash
export const MIN_ORDER_USD = 1;           // Polymarket min marketable order
export const TAKER_FEE_RATE = 0;          // set e.g. 0.01 for a flat 1% paper fee

// ---- Free, public, no-signup endpoints ----
export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB_REST = "https://clob.polymarket.com"; // public read-only /book
export const CLOB_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"; // public market channel
export const RTDS_WS = "wss://ws-live-data.polymarket.com"; // Chainlink BTC/USD (what Polymarket resolves on)
