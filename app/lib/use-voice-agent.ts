"use client";
import { useCallback, useEffect, useRef } from "react";
import type { AgentSettings, Conversation, Message } from "./types";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useCredentialsStore, useVoiceSessionApi, useWorkspaceStore } from "../stores/workspace-provider";
import { deepgramRequestHeaders } from "./deepgram-request";
import { selectSessionView } from "../stores/session-store";
import type { VoiceStatus } from "../stores/session-store";
export function useVoiceAgent() {
  const store = useVoiceSessionApi();
  const session = useStore(store, useShallow(selectSessionView<VoiceStatus>));
  const saveSession = useWorkspaceStore(state => state.saveSession);
  const apiKey = useCredentialsStore(state => state.apiKey);
  const runtime = useRef<{
    socket?: WebSocket;
    context?: AudioContext;
    stream?: MediaStream;
    node?: AudioWorkletNode;
    source?: MediaStreamAudioSourceNode;
    sink?: GainNode;
    keepAlive?: ReturnType<typeof setInterval>;
    timeout?: ReturnType<typeof setTimeout>;
    clock?: ReturnType<typeof setInterval>;
    playback: Set<AudioBufferSourceNode>;
    nextAudio: number;
    ready: boolean;
    generation: number;
    conversation?: Conversation;
    pendingAt?: number;
    mute: boolean;
  }>({ playback: new Set(), nextAudio: 0, ready: false, generation: 0, mute: false });
  const stopPlayback = useCallback(() => {
    const r = runtime.current;
    r.playback.forEach(source => { try {
      source.stop();
    }
    catch { } });
    r.playback.clear();
    r.nextAudio = 0;
  }, []);
  const stop = useCallback(() => {
    const r = runtime.current;
    r.generation++;
    r.ready = false;
    clearInterval(r.keepAlive);
    clearInterval(r.clock);
    clearTimeout(r.timeout);
    if (r.socket) {
      r.socket.onclose = null;
      r.socket.onerror = null;
      r.socket.onmessage = null;
      r.socket.close();
      r.socket = undefined;
    }
    r.stream?.getTracks().forEach(track => track.stop());
    r.stream = undefined;
    r.node?.disconnect();
    r.source?.disconnect();
    r.sink?.disconnect();
    stopPlayback();
    if (r.context && r.context.state !== "closed")
      void r.context.close();
    r.context = undefined;
    if (r.conversation) {
      r.conversation.duration = Math.round((Date.now() - r.conversation.startedAt) / 1000);
      if (r.conversation.messages.length)
        saveSession({ ...r.conversation });
      r.conversation = undefined;
    }
    store.setState({ status: "idle", level: 0, muted: false });
    r.mute = false;
  }, [stopPlayback, store, saveSession]);
  useEffect(() => () => stop(), [stop]);
  const start = async (settings: AgentSettings) => {
    stop();
    store.setState({ messages: [], error: "", elapsed: 0, latency: null, status: "connecting" });
    const r = runtime.current;
    const generation = r.generation;
    const current = () => runtime.current.generation === generation;
    const fail = (message: string) => { if (current()) {
      store.setState({ error: message });
      stop();
    } };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
        throw new Error("Voice calls need a modern browser on localhost or HTTPS.");
      // Resume from the click gesture before waiting for network or permission prompts.
      const context = new AudioContext({ sampleRate: 24000 });
      r.context = context;
      await context.resume();
      const response = await fetch("/api/deepgram/token", { method: "POST", headers: deepgramRequestHeaders(apiKey) });
      const data = await response.json();
      if (!current())
        return;
      if (!response.ok)
        throw new Error(data.error || "Could not connect to Deepgram.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!current()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      r.stream = stream;
      await context.audioWorklet.addModule("/pcm-worklet.js");
      if (!current())
        return;
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm-recorder");
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(context.destination);
      r.source = source;
      r.node = node;
      r.sink = sink;
      // Grant JWTs use the bearer subprotocol; the long-lived API key stays server-side.
      const socket = new WebSocket("wss://agent.deepgram.com/v1/agent/converse", ["bearer", data.token]);
      socket.binaryType = "arraybuffer";
      r.socket = socket;
      node.port.onmessage = event => {
        if (!current() || !r.ready || socket.readyState !== WebSocket.OPEN)
          return;
        store.setState({ level: r.mute ? 0 : Math.min(1, event.data.level * 6) });
        // Keep the stream alive with silence while the microphone is muted.
        if (socket.bufferedAmount < 256000)
          socket.send(r.mute ? new ArrayBuffer(event.data.pcm.byteLength) : event.data.pcm);
      };
      r.timeout = setTimeout(() => fail("Deepgram took too long to connect. Please try again."), 20000);
      socket.onmessage = event => {
        if (!current())
          return;
        if (event.data instanceof ArrayBuffer) {
          const pcm = new Int16Array(event.data);
          if (!pcm.length)
            return;
          const buffer = context.createBuffer(1, pcm.length, 24000);
          const samples = buffer.getChannelData(0);
          for (let i = 0; i < pcm.length; i++)
            samples[i] = pcm[i] / 32768;
          const audio = context.createBufferSource();
          audio.buffer = buffer;
          audio.connect(context.destination);
          const when = Math.max(context.currentTime + 0.015, r.nextAudio);
          r.nextAudio = when + buffer.duration;
          r.playback.add(audio);
          audio.onended = () => { r.playback.delete(audio); if (current() && !r.playback.size)
            store.setState({ status: "listening" }); };
          audio.start(when);
          store.setState({ status: "speaking" });
          return;
        }
        let message;
        try {
          message = JSON.parse(event.data);
        }
        catch {
          return;
        }
        switch (message.type) {
          case "Welcome":
            socket.send(JSON.stringify({ type: "Settings", audio: { input: { encoding: "linear16", sample_rate: context.sampleRate }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } }, agent: { language: "en", listen: { provider: { type: "deepgram", model: "nova-3" } }, think: { provider: { type: "open_ai", model: "gpt-4o-mini" }, prompt: settings.prompt }, speak: { provider: { type: "deepgram", model: settings.voice } }, greeting: settings.greeting } }));
            break;
          case "SettingsApplied":
            clearTimeout(r.timeout);
            r.ready = true;
            store.setState({ status: "listening" });
            r.conversation = { id: crypto.randomUUID(), title: "New conversation", startedAt: Date.now(), duration: 0, messages: [], voice: settings.voice };
            r.clock = setInterval(() => store.setState({ elapsed: Math.round((Date.now() - r.conversation!.startedAt) / 1000) }), 1000);
            r.keepAlive = setInterval(() => { if (socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ type: "KeepAlive" })); }, 5000);
            break;
          case "ConversationText": {
            if (!r.conversation || !message.content || !["user", "assistant"].includes(message.role))
              break;
            const entry: Message = { id: crypto.randomUUID(), role: message.role, content: message.content, at: Date.now() };
            r.conversation.messages = [...r.conversation.messages, entry];
            if (entry.role === "user" && r.conversation.title === "New conversation")
              r.conversation.title = entry.content.slice(0, 65);
            r.conversation.duration = Math.round((Date.now() - r.conversation.startedAt) / 1000);
            store.setState({ messages: [...r.conversation.messages] });
            saveSession({ ...r.conversation });
            if (entry.role === "assistant" && r.pendingAt) {
              store.setState({ latency: Date.now() - r.pendingAt });
              r.pendingAt = undefined;
            }
            break;
          }
          case "UserStartedSpeaking":
            stopPlayback();
            store.setState({ status: "listening" });
            break;
          case "AgentThinking":
            r.pendingAt = Date.now();
            store.setState({ status: "thinking" });
            break;
          case "AgentAudioDone":
            if (!r.playback.size)
              store.setState({ status: "listening" });
            break;
          case "Error":
            fail(message.description || message.message || "Deepgram reported an error. Please check your agent settings.");
            break;
          case "Warning":
            store.setState({ error: message.description || "Deepgram reported a configuration warning." });
            break;
        }
      };
      socket.onerror = () => fail("Unable to connect to Deepgram. Check your API access and network connection.");
      socket.onclose = event => { if (current()) {
        if (event.code !== 1000)
          store.setState({ error: "The connection ended unexpectedly. Your transcript has been saved." });
        stop();
      } };
    }
    catch (e) {
      const message = e instanceof Error ? e.message : "Could not start the conversation.";
      fail(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was blocked. Allow microphone access in your browser and try again." : message);
    }
  };
  const toggleMute = () => { const r = runtime.current; r.mute = !r.mute; store.setState({ muted: r.mute }); };
  const sendText = (content: string) => {
    const r = runtime.current;
    if (r.ready && r.socket?.readyState === WebSocket.OPEN && content.trim()) {
      r.socket.send(JSON.stringify({ type: "InjectUserMessage", content: content.trim() }));
      return true;
    }
    return false;
  };
  const reset = () => { stop(); store.setState({ messages: [], error: "", elapsed: 0, latency: null }); };
  return { ...session, start, stop, reset, toggleMute, sendText, clearError: () => store.setState({ error: "" }) };
}
