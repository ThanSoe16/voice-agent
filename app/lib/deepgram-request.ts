export function deepgramRequestHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { "X-Deepgram-Api-Key": apiKey } : {};
}
