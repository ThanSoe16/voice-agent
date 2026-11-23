export type AgentSettings = { name: string; voice: string; prompt: string; greeting: string };
export type Message = { id: string; role: "user" | "assistant"; content: string; at: number };
export type Conversation = { id: string; title: string; startedAt: number; duration: number; messages: Message[]; voice: string; demo?: boolean; mode?: "lab" | "live" };
export const voices = [
  { id: "aura-2-thalia-en", name: "Thalia", detail: "Warm & conversational" },
  { id: "aura-2-andromeda-en", name: "Andromeda", detail: "Casual & expressive" },
  { id: "aura-2-helena-en", name: "Helena", detail: "Friendly & natural" },
  { id: "aura-2-apollo-en", name: "Apollo", detail: "Confident & relaxed" },
];
export const defaultSettings: AgentSettings = {
  name: "My voice agent", voice: voices[0].id,
  prompt: "You are a friendly, helpful AI voice assistant. Keep your responses natural and concise, usually one or two sentences. Ask clarifying questions when needed. Do not use markdown or lists in spoken replies.",
  greeting: "Hey there! I'm your AI voice assistant. What would you like to talk about today?",
};
export function durationLabel(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }
