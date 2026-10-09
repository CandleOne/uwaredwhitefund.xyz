const ALPACA_PAPER_API = "https://paper-api.alpaca.markets";

function corsHeaders(origin, allowedOrigin) {
  if (origin !== allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function alpacaRequest(path, env) {
  const response = await fetch(`${ALPACA_PAPER_API}${path}`, {
    headers: {
      Accept: "application/json",
      "APCA-API-KEY-ID": env.ALPACA_API_KEY,
      "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET,
    },
  });
  if (!response.ok) throw new Error(`Alpaca returned ${response.status} for ${path}.`);
  return response.json();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (origin !== env.ALLOWED_ORIGIN) return jsonResponse({ error: "Origin is not allowed." }, 403, headers);
    if (request.method !== "GET" || url.pathname !== "/v1/dashboard") return jsonResponse({ error: "Not found." }, 404, headers);
    try {
      const [account, positions, orders] = await Promise.all([
        alpacaRequest("/v2/account", env),
        alpacaRequest("/v2/positions", env),
        alpacaRequest("/v2/orders?status=all&limit=10&direction=desc", env),
      ]);
      return jsonResponse({ account, positions, orders }, 200, headers);
    } catch (error) {
      console.error("Unable to retrieve Alpaca paper-account data:", error);
      return jsonResponse({ error: "Unable to retrieve paper-account data." }, 502, headers);
    }
  },
};
