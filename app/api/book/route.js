export const dynamic = "force-dynamic";

// Fallback proxy in case the browser can't read Polymarket's public order book directly (CORS).
export async function GET(req) {
  const id = new URL(req.url).searchParams.get("token_id") || "";
  if (!/^\d{5,100}$/.test(id)) {
    return Response.json({ error: "bad token_id" }, { status: 400 });
  }
  const r = await fetch(`https://clob.polymarket.com/book?token_id=${id}`, { cache: "no-store" });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
