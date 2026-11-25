"use client";
import { useCallback, useEffect, useRef } from "react";
import type { AgentSettings, Conversation, Message } from "./types";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useCredentialsStore, useVoiceSessionApi, useWorkspaceStore } from "../stores/workspace-provider";
import { deepgramRequestHeaders } from "./deepgram-request";
import { selectSessionView } from "../stores/session-store";
import type { VoiceStatus } from "../stores/session-store";
import { buildVoiceAgentSettings, DeliveryController, deliverySettings, initialDelivery } from "./emotional-delivery";
import { PcmPlayback } from "./pcm-playback";
import { VoiceAgentTransport } from "./voice-agent-transport";

export function useVoiceAgent() {
  const store = useVoiceSessionApi();
  const session = useStore(store, useShallow(selectSessionView<VoiceStatus>));
  const saveSession = useWorkspaceStore(state => state.saveSession);
  const apiKey = useCredentialsStore(state => state.apiKey);
  const runtime = useRef<{
    transport?: VoiceAgentTransport;
    playback?: PcmPlayback;
    delivery?: DeliveryController;
    context?: AudioContext;
    stream?: MediaStream;
    node?: AudioWorkletNode;
    source?: MediaStreamAudioSourceNode;
    sink?: GainNode;
    clock?: ReturnType<typeof setInterval>;
    controller?: AbortController;
    generation: number;
    conversation?: Conversation;
    pendingAt?: number;
    mute: boolean;
  }>({ generation: 0, mute: false });

  const stop = useCallback(() => {
    const r = runtime.current;
    r.generation++;
    r.controller?.abort();
    r.transport?.close();
    r.delivery?.dispose();
    r.playback?.interrupt();
    clearInterval(r.clock);
    r.stream?.getTracks().forEach(track => track.stop());
    r.node?.disconnect();
    r.source?.disconnect();
    r.sink?.disconnect();
    if (r.context && r.context.state !== "closed") void r.context.close();
    if (r.conversation?.messages.length) {
      r.conversation.duration = Math.round((Date.now() - r.conversation.startedAt) / 1000);
      saveSession({ ...r.conversation });
    }
    r.transport = undefined;
    r.delivery = undefined;
    r.playback = undefined;
    r.context = undefined;
    r.stream = undefined;
    r.node = undefined;
    r.source = undefined;
    r.sink = undefined;
    r.conversation = undefined;
    r.pendingAt = undefined;
    r.mute = false;
    store.setState({ status: "idle", level: 0, muted: false, activeVoice: "", warning: "" });
  }, [store, saveSession]);
  useEffect(() => () => stop(), [stop]);

  const start = async (settings: AgentSettings) => {
    stop();
    if (!apiKey) { store.setState({ error: "Add a Deepgram API key in Agent settings." }); return; }
    const config = deliverySettings(settings);
    let forceAura = false;
    const turnMessageIds = new Set<string>();
    const auraNotice = "Expressive TTS is unavailable. Using your main Aura voice with neutral delivery.";
    store.setState({ messages: [], error: "", warning: "", elapsed: 0, latency: null, status: "connecting", delivery: initialDelivery(config) });
    const r = runtime.current;
    const generation = r.generation;
    const current = () => runtime.current.generation === generation;
    const fail = (error: string) => { if (current()) { store.setState({ error }); stop(); } };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Voice calls need a modern browser on localhost or HTTPS.");
      const context = new AudioContext({ sampleRate: 24000 });
      r.context = context;
      await context.resume();
      if (!current()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      r.stream = stream;
      await context.audioWorklet.addModule("/pcm-worklet.js");
      if (!current()) return;
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm-recorder");
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node); node.connect(sink); sink.connect(context.destination);
      Object.assign(r, { source, node, sink });
      r.playback = new PcmPlayback(context,
        () => { if (current() && store.getState().status !== "connecting") store.setState({ status: "listening" }); },
        () => { if (current()) store.setState({ status: "speaking" }); });
      r.delivery = new DeliveryController(config, delivery => { if (current()) store.setState({ delivery }); });
      r.controller = new AbortController();

      r.transport = new VoiceAgentTransport({
        token: async () => {
          const response = await fetch("/api/deepgram/token", { method: "POST", headers: deepgramRequestHeaders(apiKey), signal: r.controller?.signal });
          const data = await response.json();
          if (!response.ok || typeof data.token !== "string") throw new Error(data.error || "Could not authorize the voice connection.");
          return data.token;
        },
        settings: resuming => buildVoiceAgentSettings(settings, { sampleRate: context.sampleRate, resuming, history: r.conversation?.messages ?? [], forceAura, lastTone: r.delivery?.snapshot().tone }),
        onReady: resuming => {
          if (!current()) return;
          if (!resuming) {
            r.conversation = { id: crypto.randomUUID(), title: "New conversation", startedAt: Date.now(), duration: 0, messages: [], voice: config.enabled && !forceAura ? config.voice : settings.voice, mode: "live", metrics: { deliveryEnabled: config.enabled, firstAudioLatencyMs: [], reconnects: 0 } };
            r.clock = setInterval(() => { if (r.conversation) store.setState({ elapsed: Math.round((Date.now() - r.conversation.startedAt) / 1000) }); }, 1000);
          } else if (r.conversation?.metrics) r.conversation.metrics.reconnects++;
          r.playback?.beginTurn();
          turnMessageIds.clear();
          r.delivery?.beginTurn();
          if (forceAura) r.delivery?.fallback();
          store.setState({ status: "listening", warning: forceAura ? auraNotice : "", activeVoice: config.enabled && !forceAura ? config.voice : settings.voice });
        },
        onAudio: audio => {
          if (!current() || !r.playback?.queue(audio)) return;
          if (r.pendingAt !== undefined) {
            const latency = Math.round(performance.now() - r.pendingAt);
            r.pendingAt = undefined;
            store.setState({ latency });
            if (r.conversation?.metrics) {
              r.conversation.metrics.firstAudioLatencyMs.push(latency);
              saveSession({ ...r.conversation });
            }
          }
        },
        onReconnecting: attempt => {
          if (!current()) return;
          r.playback?.interrupt();
          r.pendingAt = undefined;
          store.setState({ status: "connecting", level: 0, warning: `Reconnecting (${attempt}/2)… Your conversation context is retained.` });
        },
        onFatal: fail,
        onEnd: () => { if (current()) stop(); },
        onMessage: message => {
          if (!current()) return;
          r.playback?.handleEvent(message);
          switch (message.type) {
            case "ConversationText": {
              if (!r.conversation || typeof message.content !== "string" || !message.content || (message.role !== "user" && message.role !== "assistant")) break;
              const spoken = message.role === "assistant" && config.enabled ? r.delivery?.response(message.content) : undefined;
              const entry: Message = { id: crypto.randomUUID(), role: message.role, content: spoken?.text ?? message.content, at: Date.now(), ...(spoken ? { delivery: spoken.delivery } : {}) };
              if (entry.role === "assistant") turnMessageIds.add(entry.id);
              r.conversation.messages = [...r.conversation.messages, entry];
              if (entry.role === "user" && r.conversation.title === "New conversation") r.conversation.title = entry.content.slice(0, 65);
              r.conversation.duration = Math.round((Date.now() - r.conversation.startedAt) / 1000);
              store.setState({ messages: [...r.conversation.messages] });
              saveSession({ ...r.conversation });
              break;
            }
            case "UserStartedSpeaking":
              r.pendingAt = undefined;
              turnMessageIds.clear();
              store.setState({ status: "listening" });
              break;
            case "AgentThinking":
              if (r.pendingAt === undefined) { r.pendingAt = performance.now(); turnMessageIds.clear(); }
              r.delivery?.beginTurn();
              if (forceAura) r.delivery?.fallback();
              store.setState({ status: "thinking", warning: forceAura ? auraNotice : "" });
              break;
            case "FunctionCallRequest":
              r.delivery?.request(message.functions, response => { r.transport?.send(response); });
              break;
            case "FunctionCallCancelled": r.delivery?.cancel(message.functions); break;
            case "AgentAudioDone": if (!r.playback?.pending) store.setState({ status: "listening" }); break;
            case "Warning":
              if (message.code === "SPEAK_REQUEST_FAILED" && config.enabled) {
                r.delivery?.fallback();
                if (r.conversation) {
                  r.conversation.messages = r.conversation.messages.map(entry => turnMessageIds.has(entry.id) ? { ...entry, delivery: r.delivery?.snapshot() } : entry);
                  store.setState({ messages: [...r.conversation.messages] });
                  saveSession({ ...r.conversation });
                }
                store.setState({ warning: "The preferred TTS delivery failed. Retrying with neutral delivery or your Aura fallback." });
              } else store.setState({ warning: typeof message.description === "string" ? message.description : "Deepgram reported a configuration warning." });
              break;
            case "Error":
              if (config.enabled && !forceAura && message.code === "INVALID_SETTINGS") {
                forceAura = true;
                r.delivery?.fallback();
                r.transport?.restart();
              } else fail(typeof message.description === "string" ? message.description : "Deepgram reported an error. Check your settings and try again.");
              break;
          }
        },
      });
      node.port.onmessage = event => {
        if (!current()) return;
        store.setState({ level: r.mute ? 0 : Math.min(1, event.data.level * 6) });
        r.transport?.sendAudio(r.mute ? new ArrayBuffer(event.data.pcm.byteLength) : event.data.pcm);
      };
      // The token is minted after the permission prompt, immediately before use.
      r.transport.connect();
    } catch (error) {
      fail(error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser and try again." : error instanceof Error ? error.message : "Could not start the conversation.");
    }
  };
  const toggleMute = () => { const r = runtime.current; r.mute = !r.mute; store.setState({ muted: r.mute }); };
  const sendText = (content: string) => {
    if (!content.trim() || store.getState().status === "idle" || store.getState().status === "connecting") return false;
    return runtime.current.transport?.send({ type: "InjectUserMessage", content: content.trim() }) ?? false;
  };
  const reset = () => { stop(); store.setState({ messages: [], error: "", warning: "", elapsed: 0, latency: null }); };
  return { ...session, start, stop, reset, toggleMute, sendText, clearError: () => store.setState({ error: "" }) };
}
