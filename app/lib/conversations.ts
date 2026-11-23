import type { Conversation } from "./types";
import { durationLabel, voices } from "./types";

export function dateLabel(timestamp: number) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp); }
export function voiceLabel(id: string) { return voices.find(v => v.id === id)?.name || "Thalia"; }
export function downloadSession(session: Conversation) {
  const text = `${session.title}\n${dateLabel(session.startedAt)} · ${durationLabel(session.duration)} · ${session.demo ? "Example" : session.mode === "lab" ? "Speech lab" : "Live agent"}\n\n${session.messages.map(m => `${m.role === "user" ? "You" : "Agent"}: ${m.content}`).join("\n\n")}`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `vocal-${session.id.slice(0, 8)}.txt`; a.click(); URL.revokeObjectURL(url);
}

