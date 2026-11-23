export async function POST(request: Request) {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "Missing Deepgram API key" },
      { status: 500 },
    );
  }

  const form = await request.formData();
  const audio = form.get("audio");

  if (!(audio instanceof File)) {
    return Response.json({ error: "Audio file is required" }, { status: 400 });
  }

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type || "application/octet-stream",
      },
      body: await audio.arrayBuffer(),
    },
  );

  if (!response.ok) {
    return Response.json(
      { error: "Deepgram transcription failed" },
      { status: 502 },
    );
  }

  const result = await response.json();

  const transcript =
    result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

  return Response.json({ transcript });
}
