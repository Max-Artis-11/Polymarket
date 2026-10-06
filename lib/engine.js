// Walk the live order book to get a realistic (VWAP) fill.
// asks: [[price,size]] ascending, bids: [[price,size]] descending

export function walkBuy(asks, dollars) {
  let spent = 0;
  let shares = 0;
  for (const [p, s] of asks || []) {
    if (spent >= dollars - 1e-9) break;
    const take = Math.min(dollars - spent, p * s);
    shares += take / p;
    spent += take;
  }
  return { shares, spent, avg: shares ? spent / shares : 0 };
}

export function walkSell(bids, sharesToSell) {
  let left = sharesToSell;
  let proceeds = 0;
  let shares = 0;
  for (const [p, s] of bids || []) {
    if (left <= 1e-9) break;
    const take = Math.min(left, s);
    proceeds += take * p;
    shares += take;
    left -= take;
  }
  return { shares, proceeds, avg: shares ? proceeds / shares : 0 };
}
