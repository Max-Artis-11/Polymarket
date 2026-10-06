export const dynamic = "force-dynamic";

// Polymarket's own page gets the exact "price to beat" (the Chainlink BTC/USD open for the
// window) from this endpoint. Browsers can't call it (CORS), so we fetch it server-side.
export async function GET(req) {
  const start = parseInt(new URL(req.url).searchParams.get("start") || "", 10);
  if (!start || start % 300 !== 0) {
    return Response.json({ error: "bad start" }, { status: 400 });
  }
  const iso = (s) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
  const url =
    `https://polymarket.com/api/crypto/crypto-price?symbol=BTC` +
    `&eventStartTime=${encodeURIComponent(iso(start))}&variant=fiveminute` +
    `&endDate=${encodeURIComponent(iso(start + 300))}`;
  try {
    const r = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; PolyPaper)" },
    });
    if (!r.ok) return Response.json({ error: "upstream " + r.status }, { status: 502 });
    const j = await r.json();
    const v = j.openPrice ?? j.open_price ?? j.priceToBeat;
    if (v == null || isNaN(+v)) return Response.json({ error: "no price" }, { status: 404 });
    return new Response(JSON.stringify({ openPrice: +v }), {
      headers: { "content-type": "application/json", "cache-control": "public, s-maxage=300" },
    });
  } catch {
    return Response.json({ error: "fetch failed" }, { status: 502 });
  }
}
