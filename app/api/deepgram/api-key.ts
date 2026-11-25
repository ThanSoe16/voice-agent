// Use only the key supplied from this browser's saved settings.
export function getDeepgramApiKey(request: Request) {
  return request.headers.get("X-Deepgram-Api-Key")?.trim() || undefined;
}
