export const dynamic = "force-dynamic";

// Fallback proxy in case the browser can't call Polymarket's Gamma API directly (CORS).
export async function GET(req) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  if (!/^btc-updown-5m-\d+$/.test(slug)) {
    return Response.json({ error: "bad slug" }, { status: 400 });
  }
  const r = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`, { cache: "no-store" });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
