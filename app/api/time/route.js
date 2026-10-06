export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(JSON.stringify({ t: Date.now() }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
