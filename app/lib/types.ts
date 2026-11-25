export const responseTones = ["neutral", "happy", "excited", "empathetic", "calm", "concerned", "reassuring", "professional"] as const;
export type ResponseTone = typeof responseTones[number];
export type Expressivity = -2 | -1 | 0 | 1 | 2;
export type EmotionalDeliverySettings = {
  enabled: boolean;
  mode: "automatic" | "manual";
  defaultExpressivity: Expressivity;
  defaultTone: ResponseTone;
  voice: string;
};
export const fluxVoices = [{ id: "flux-kit-en", name: "Kit" }, { id: "flux-alexis-en", name: "Alexis" }];
export const defaultEmotionalDelivery: EmotionalDeliverySettings = {
  enabled: false, mode: "automatic", defaultExpressivity: 0, defaultTone: "neutral", voice: "flux-kit-en",
};
export type SpeechDelivery = {
  tone: ResponseTone;
  expressivity: Expressivity;
  suggestedExpressivity: Expressivity;
  source: "llm" | "default";
  neutralFallback: boolean;
};
export type SpokenResponse = { text: string; delivery: SpeechDelivery };
export type AgentSettings = { name: string; voice: string; prompt: string; greeting: string; emotionalDelivery?: EmotionalDeliverySettings };
export type Message = { id: string; role: "user" | "assistant"; content: string; at: number; delivery?: SpeechDelivery; voice?: string; emotion?: string };
export type ConversationMetrics = { deliveryEnabled: boolean; firstAudioLatencyMs: number[]; reconnects: number };
export type Conversation = { id: string; title: string; startedAt: number; duration: number; messages: Message[]; voice: string; demo?: boolean; mode?: "lab" | "live"; metrics?: ConversationMetrics };
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
  emotionalDelivery: { ...defaultEmotionalDelivery },
};
export function durationLabel(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }
