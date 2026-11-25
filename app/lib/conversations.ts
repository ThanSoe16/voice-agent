import type { Conversation } from "./types";
import { durationLabel, fluxVoices, voices } from "./types";

export function dateLabel(timestamp: number) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp); }
export function voiceLabel(id: string) { return [...voices, ...fluxVoices].find(v => v.id === id)?.name || "Thalia"; }
export function sessionText(session: Conversation) {
  const samples = session.metrics?.firstAudioLatencyMs ?? [];
  const metrics = session.metrics ? `\nDelivery: ${session.metrics.deliveryEnabled ? "Expressive TTS" : "Aura baseline"}\nThinking to first audio: ${samples.length ? `${Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)} ms mean (${samples.length} samples)` : "not measured"}\nReconnects: ${session.metrics.reconnects}` : "";
  return `${session.title}\n${dateLabel(session.startedAt)} · ${durationLabel(session.duration)} · ${session.demo ? "Example" : session.mode === "lab" ? "Speech lab" : "Live agent"}${metrics}\n\n${session.messages.map(message => `${message.role === "user" ? "You" : "Agent"}${message.delivery ? ` [${message.delivery.tone}; session expressivity ${message.delivery.expressivity}${message.delivery.neutralFallback ? "; neutral fallback" : ""}]` : ""}: ${message.content}`).join("\n\n")}`;
}
export function downloadSession(session: Conversation) {
  const text = sessionText(session);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `vocal-${session.id.slice(0, 8)}.txt`; a.click(); URL.revokeObjectURL(url);
}

