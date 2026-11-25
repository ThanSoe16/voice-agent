import { defaultEmotionalDelivery, fluxVoices, responseTones } from "./types";
import type { AgentSettings, EmotionalDeliverySettings, Expressivity, Message, ResponseTone, SpeechDelivery, SpokenResponse } from "./types";

// Application policy, not Deepgram emotion labels. Adjust this mapping after
// auditioning real speech; nonzero Flux expressivity values are experimental.
export const toneExpressivity: Readonly<Record<ResponseTone, Expressivity>> = {
  neutral: 0, happy: 1, excited: 2, empathetic: -1, calm: -2, concerned: -1, reassuring: -1, professional: 0,
};
export function isTone(value: unknown): value is ResponseTone { return responseTones.some(tone => tone === value); }
export function isExpressivity(value: unknown): value is Expressivity { return typeof value === "number" && Number.isInteger(value) && value >= -2 && value <= 2; }
export function isSpeechDelivery(value: unknown): value is SpeechDelivery {
  if (!value || typeof value !== "object") return false;
  const item = value as SpeechDelivery;
  return isTone(item.tone) && isExpressivity(item.expressivity) && isExpressivity(item.suggestedExpressivity)
    && ["llm", "default"].includes(item.source) && typeof item.neutralFallback === "boolean";
}
export function isDeliverySettings(value: unknown): value is EmotionalDeliverySettings {
  if (!value || typeof value !== "object") return false;
  const item = value as EmotionalDeliverySettings;
  return typeof item.enabled === "boolean" && ["automatic", "manual"].includes(item.mode)
    && isExpressivity(item.defaultExpressivity) && isTone(item.defaultTone) && fluxVoices.some(voice => voice.id === item.voice);
}
export function deliverySettings(settings: AgentSettings): EmotionalDeliverySettings {
  const value = settings.emotionalDelivery;
  if (isDeliverySettings(value)) return { ...value };
  return { ...defaultEmotionalDelivery };
}
export function sessionExpressivity(config: EmotionalDeliverySettings): Expressivity {
  if (!config.enabled) return 0;
  return config.mode === "automatic" ? toneExpressivity[config.defaultTone] ?? 0 : isExpressivity(config.defaultExpressivity) ? config.defaultExpressivity : 0;
}
export function initialDelivery(config: EmotionalDeliverySettings): SpeechDelivery {
  const tone = config.enabled && isTone(config.defaultTone) ? config.defaultTone : "neutral";
  return { tone, expressivity: sessionExpressivity(config), suggestedExpressivity: toneExpressivity[tone], source: "default", neutralFallback: false };
}

export function speakSettings(settings: AgentSettings) {
  const config = deliverySettings(settings);
  const aura = { provider: { type: "deepgram", version: "v1", model: settings.voice } };
  if (!config.enabled) return aura;
  const expressivity = sessionExpressivity(config);
  const flux = (value: Expressivity) => ({ provider: { type: "deepgram", version: "v2", model: config.voice, expressivity: value } });
  // Documented per-request fallback chain. No reconnect or model change per tone.
  return [flux(expressivity), ...(expressivity === 0 ? [] : [flux(0)]), aura];
}

export function deliveryThinkSettings(settings: AgentSettings, effectiveExpressivity?: Expressivity) {
  const config = deliverySettings(settings);
  if (!config.enabled) return { prompt: settings.prompt };
  const deliveryPrompt = `\n\nSPOKEN DELIVERY\nAdapt your response style to the user's message, conversation history, and your reply's purpose. Choose neutral, happy, excited, empathetic, calm, concerned, reassuring, or professional as a RESPONSE TONE. Text alone cannot reliably reveal a person's actual emotions; do not diagnose or claim certainty about their feelings. Acknowledge concerns with empathetic wording, celebrate positive news with measured energy, and explain confusing topics calmly. Use varied natural vocabulary, short spoken sentences, and ordinary punctuation. Avoid robotic repetition, exaggerated enthusiasm, markdown, emotion labels, stage directions, SSML, and audio tags. Never put delivery metadata in spoken text.\nYour starting response tone is ${config.defaultTone}. ${config.mode === "automatic" ? "Before a reply whose tone differs from your last selected tone, call set_response_tone once, then speak naturally in the selected style. Do not call it for every sentence or when the tone is unchanged." : `Use ${config.defaultTone} as your default response style, while remaining appropriate and empathetic to context.`}\nThe same speaker is kept throughout the conversation. Expressivity is fixed at ${effectiveExpressivity ?? sessionExpressivity(config)} for this session; tone metadata does not alter this connection-level setting. Shape each reply's delivery through word choice, sentence structure, and punctuation. Never emit unsupported speech-control tags.`;
  return {
    prompt: settings.prompt + deliveryPrompt,
    ...(config.mode === "automatic" ? { functions: [{
      // Settings route functions to the client by omitting endpoint. client_side
      // belongs to incoming FunctionCallRequest items, not function definitions.
      name: "set_response_tone", defer_until_eot: true,
      description: "Select the style of your next spoken reply, not a diagnosis of the user's feelings. Do not change the speaker or the TTS connection.",
      parameters: { type: "object", properties: { tone: { type: "string", enum: [...responseTones] } }, required: ["tone"], additionalProperties: false },
    }] } : {}),
  };
}

function decodeToneMetadata(value: unknown): { tone: ResponseTone; valid: boolean } {
  try {
    const item = typeof value === "string" ? JSON.parse(value) : value;
    return item && typeof item === "object" && isTone(item.tone) ? { tone: item.tone, valid: true } : { tone: "neutral", valid: false };
  } catch { return { tone: "neutral", valid: false }; }
}
export function parseToneMetadata(value: unknown): ResponseTone { return decodeToneMetadata(value).tone; }

export function buildVoiceAgentSettings(settings: AgentSettings, options: { sampleRate: number; resuming: boolean; history: Message[]; forceAura?: boolean; lastTone?: ResponseTone }) {
  const think = deliveryThinkSettings(settings, options.forceAura ? 0 : undefined);
  return {
    type: "Settings",
    audio: { input: { encoding: "linear16", sample_rate: options.sampleRate }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } },
    agent: {
      listen: { provider: { type: "deepgram", model: "nova-3", language: "en" } },
      think: { provider: { type: "open_ai", model: "gpt-4o-mini" }, ...think, prompt: think.prompt + (options.resuming && options.lastTone ? `\nContinuing the conversation with response tone ${options.lastTone}.` : "") },
      speak: options.forceAura ? { provider: { type: "deepgram", version: "v1", model: settings.voice } } : speakSettings(settings),
      ...(options.resuming ? { context: { messages: options.history.slice(-40).map(message => ({ type: "History", role: message.role, content: message.content })) } } : { greeting: settings.greeting }),
    },
  };
}

type FunctionCall = { id: string; name: string; arguments: unknown; client_side: boolean };
export class DeliveryController {
  private current: SpeechDelivery;
  private seen = new Set<string>();
  private changes: { id: string; delivery: SpeechDelivery }[] = [];
  private baseline: SpeechDelivery;
  private disposed = false;
  constructor(private config: EmotionalDeliverySettings, private onChange: (delivery: SpeechDelivery) => void) {
    this.current = initialDelivery(config);
    this.baseline = this.snapshot();
  }
  snapshot(): SpeechDelivery { return { ...this.current }; }
  response(text: string): SpokenResponse { return { text, delivery: this.snapshot() }; }
  request(functions: unknown, send: (message: object) => void) {
    if (this.disposed || !Array.isArray(functions)) return;
    for (const call of functions as FunctionCall[]) {
      if (!call || call.client_side !== true || typeof call.id !== "string" || typeof call.name !== "string" || this.seen.has(call.id)) continue;
      this.seen.add(call.id);
      const valid = call.name === "set_response_tone" && this.config.enabled && this.config.mode === "automatic";
      if (valid) {
        const { tone, valid: validMetadata } = decodeToneMetadata(call.arguments);
        this.current = { ...this.current, tone, suggestedExpressivity: toneExpressivity[tone], source: validMetadata ? "llm" : "default" };
        this.changes.push({ id: call.id, delivery: this.snapshot() });
        this.onChange(this.snapshot());
      }
      send({ type: "FunctionCallResponse", id: call.id, name: call.name, content: JSON.stringify(valid ? this.snapshot() : { error: "Automatic response tone selection is not enabled for this tool." }) });
    }
  }
  cancel(functions: unknown) {
    if (this.disposed || !Array.isArray(functions)) return;
    const cancelled = new Set(functions.filter(item => item && typeof item.id === "string").map(item => item.id));
    if (this.changes.some(change => cancelled.has(change.id))) {
      this.changes = this.changes.filter(change => !cancelled.has(change.id));
      this.current = { ...(this.changes.at(-1)?.delivery ?? this.baseline), expressivity: this.current.expressivity, neutralFallback: this.current.neutralFallback };
      this.onChange(this.snapshot());
    }
  }
  beginTurn() {
    if (this.disposed) return;
    this.current = { ...this.current, expressivity: sessionExpressivity(this.config), neutralFallback: false };
    this.changes = [];
    this.baseline = this.snapshot();
    this.onChange(this.snapshot());
  }
  fallback() {
    if (this.disposed) return;
    this.current = { ...this.current, expressivity: 0, neutralFallback: true };
    this.onChange(this.snapshot());
  }
  dispose() { this.disposed = true; this.changes = []; this.seen.clear(); }
}
