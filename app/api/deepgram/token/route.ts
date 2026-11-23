const headers = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json({ configured: Boolean(process.env.DEEPGRAM_API_KEY) }, { headers });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "This request must come from this app." }, { status: 403, headers });
  }
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return Response.json({ error: "Add DEEPGRAM_API_KEY to .env.local and restart the development server to start a live conversation." }, { status: 503, headers });
  try {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return Response.json({ error: "Deepgram could not authorize this session. Check that your API key has Member permissions and Voice Agent access." }, { status: 502, headers });
    const data = await response.json();
    if (typeof data.access_token !== "string") throw new Error("Invalid token response");
    return Response.json({ token: data.access_token }, { headers });
  } catch {
    return Response.json({ error: "Could not reach Deepgram. Please check your connection and try again." }, { status: 502, headers });
  }
}
