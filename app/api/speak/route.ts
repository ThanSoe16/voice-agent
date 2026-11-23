export async function POST(request: Request) {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "Missing Deepgram API key" },
      { status: 500 },
    );
  }

  const { text, voice = "aura-2-thalia-en" } = await request.json();

  if (
    typeof text !== "string" ||
    text.trim().length === 0 ||
    text.length > 1000
  ) {
    return Response.json({ error: "Invalid text" }, { status: 400 });
  }

  const allowedVoices = [
    "aura-2-thalia-en",
    "aura-2-andromeda-en",
    "aura-2-helena-en",
    "aura-2-apollo-en",
  ];
  if (!allowedVoices.includes(voice)) {
    return Response.json(
      { error: "Please select a supported voice." },
      { status: 400 },
    );
  }

  const response = await fetch(
    `https://api.deepgram.com/v1/speak?model=${voice}&encoding=mp3`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!response.ok) {
    return Response.json(
      { error: "Speech generation failed" },
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
