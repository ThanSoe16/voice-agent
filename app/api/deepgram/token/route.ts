import { getDeepgramApiKey } from "../api-key";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "This request must come from this app." }, { status: 403, headers });
  }
  const apiKey = getDeepgramApiKey(request);
  if (!apiKey) return Response.json({ error: "Add a Deepgram API key in Agent settings to start a live conversation." }, { status: 503, headers });
  try {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      // Keep provider response bodies private; explain the failure using its status.
      const error = response.status === 401
        ? "Deepgram rejected the API key. Save a valid key in Agent settings and try again."
        : response.status === 403
          ? "Deepgram denied permission to create a session token (403). Create an API key with Member or higher permissions in Deepgram Console, then save it in Agent settings."
          : response.status === 429
            ? "Deepgram is rate limiting session requests. Wait a moment and try again."
            : response.status >= 500
              ? "Deepgram is temporarily unavailable. Please try again shortly."
              : "Deepgram rejected the session token request. Check your Deepgram project configuration.";
      return Response.json({ error }, { status: response.status === 429 ? 429 : 502, headers });
    }
    const data = await response.json();
    if (typeof data?.access_token !== "string" || !data.access_token) {
      return Response.json({ error: "Deepgram returned an invalid session token. Please try again." }, { status: 502, headers });
    }
    return Response.json({ token: data.access_token }, { headers });
  } catch {
    return Response.json({ error: "Could not reach Deepgram. Please check your connection and try again." }, { status: 502, headers });
  }
}
