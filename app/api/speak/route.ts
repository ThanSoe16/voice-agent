import { getDeepgramApiKey } from "../deepgram/api-key";
import { fluxVoices, voices } from "../../lib/types";
import { isExpressivity } from "../../lib/emotional-delivery";

export async function POST(request: Request) {
  const apiKey = getDeepgramApiKey(request);

  if (!apiKey) {
    return Response.json(
      { error: "Add a Deepgram API key in Agent settings." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid speech request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid speech request." }, { status: 400 });
  const { text, voice = "aura-2-thalia-en", expressivity = 0 } = body as Record<string, unknown>;

  if (
    typeof text !== "string" ||
    text.trim().length === 0 ||
    text.length > 1000
  ) {
    return Response.json({ error: "Invalid text" }, { status: 400 });
  }

  const flux = fluxVoices.some(item => item.id === voice);
  if (typeof voice !== "string" || (!flux && !voices.some(item => item.id === voice))) {
    return Response.json(
      { error: "Please select a supported voice." },
      { status: 400 },
    );
  }
  if (!isExpressivity(expressivity) || (!flux && expressivity !== 0)) {
    return Response.json({ error: "Choose a valid expressivity from -2 to 2 for a Flux voice." }, { status: 400 });
  }

  // Flux batch supports MP3, unlike its raw-audio-only live transport. Preview
  // the exact selected voice/register rather than silently substituting Aura.
  const params = new URLSearchParams({ model: voice, encoding: "mp3" });
  if (flux) params.set("expressivity", String(expressivity));
  let response: Response;
  try {
    response = await fetch(
      `https://api.deepgram.com/${flux ? "v2" : "v1"}/speak?${params}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: request.signal,
        cache: "no-store",
      },
    );
  } catch {
    return Response.json({ error: "Could not reach Deepgram. Please try again." }, { status: 502 });
  }

  if (!response.ok) {
    return Response.json(
      { error: response.status === 401 || response.status === 403 ? "Deepgram could not authorize this voice. Check your API key permissions." : "Speech generation failed. Try again or choose another voice." },
      { status: 502 },
    );
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
