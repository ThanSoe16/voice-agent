"use client";
import { useCallback, useEffect, useRef } from "react";
import type { Conversation, Message } from "./types";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useLabSessionApi, useWorkspaceStore } from "../stores/workspace-provider";
import { selectSessionView } from "../stores/session-store";
import type { LabStatus } from "../stores/session-store";
export function useSpeechLab() {
  const store = useLabSessionApi();
  const session = useStore(store, useShallow(selectSessionView<LabStatus>));
  const saveSession = useWorkspaceStore(state => state.saveSession);
  const state = useRef<{
    recorder?: MediaRecorder;
    stream?: MediaStream;
    context?: AudioContext;
    analyser?: AnalyserNode;
    frame?: number;
    clock?: ReturnType<typeof setInterval>;
    session?: Conversation;
    audio?: HTMLAudioElement;
    url?: string;
    controller?: AbortController;
    generation: number;
    startedAt: number;
  }>({ generation: 0, startedAt: 0 });
  const releaseMic = useCallback(() => {
    const r = state.current;
    r.stream?.getTracks().forEach(t => t.stop());
    r.stream = undefined;
    if (r.frame)
      cancelAnimationFrame(r.frame);
    clearInterval(r.clock);
    if (r.context && r.context.state !== "closed")
      void r.context.close();
    r.context = undefined;
    store.setState({ level: 0, muted: false });
  }, [store]);
  const reset = useCallback(() => {
    const r = state.current;
    r.generation++;
    r.controller?.abort();
    if (r.recorder && r.recorder.state !== "inactive") {
      r.recorder.onstop = null;
      r.recorder.stop();
    }
    releaseMic();
    r.audio?.pause();
    if (r.url)
      URL.revokeObjectURL(r.url);
    r.url = undefined;
    r.session = undefined;
    r.audio = undefined;
    store.setState({ audioUrl: "", messages: [], elapsed: 0, latency: null, error: "", status: "idle" });
  }, [releaseMic, store]);
  useEffect(() => () => { reset(); }, [reset]);
  function append(role: Message["role"], content: string, voice: string) {
    const r = state.current;
    if (!r.session)
      r.session = { id: crypto.randomUUID(), title: content.slice(0, 65), startedAt: Date.now(), duration: 0, voice, messages: [], mode: "lab" };
    const entry: Message = { id: crypto.randomUUID(), role, content, at: Date.now() };
    r.session.messages = [...r.session.messages, entry];
    r.session.duration += role === "user" ? Math.round((Date.now() - r.startedAt) / 1000) : 0;
    store.setState({ messages: [...r.session.messages] });
    saveSession({ ...r.session });
  }
  const start = async (voice: string) => {
    const r = state.current;
    const generation = ++r.generation;
    store.setState({ error: "" });
    r.audio?.pause();
    store.setState({ status: "processing", elapsed: 0, latency: null });
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("Recording requires a modern browser on localhost or HTTPS.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (r.generation !== generation) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      r.stream = stream;
      const context = new AudioContext();
      r.context = context;
      await context.resume();
      if (r.generation !== generation)
        return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      r.analyser = analyser;
      const samples = new Uint8Array(analyser.fftSize);
      function meter() {
        if (r.generation !== generation)
          return;
        analyser.getByteTimeDomainData(samples);
        const energy = samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0);
        store.setState({ level: Math.min(1, Math.sqrt(energy / samples.length) * 5) });
        r.frame = requestAnimationFrame(meter);
      }
      meter();
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      r.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size)
        chunks.push(event.data); };
      recorder.onerror = () => { releaseMic(); store.setState({ error: "The browser could not finish recording. Please try again.", status: "idle" }); };
      recorder.onstop = async () => {
        releaseMic();
        if (r.generation !== generation)
          return;
        store.setState({ status: "processing" });
        r.controller = new AbortController();
        const requestedAt = performance.now();
        try {
          const form = new FormData();
          form.append("audio", new Blob(chunks, { type: recorder.mimeType }), "recording");
          const response = await fetch("/api/transcribe", { method: "POST", body: form, signal: r.controller.signal });
          const data = await response.json();
          if (r.generation !== generation)
            return;
          if (!response.ok)
            throw new Error(data.error || "Transcription failed. Please try again.");
          if (!data.transcript?.trim())
            throw new Error("No speech detected. Move closer to your microphone and try again.");
          store.setState({ latency: Math.round(performance.now() - requestedAt) });
          append("user", data.transcript, voice);
          store.setState({ status: "idle" });
        }
        catch (err) {
          if (r.generation !== generation)
            return;
          store.setState({ error: err instanceof Error ? err.message : "Transcription failed.", status: "idle" });
        }
      };
      r.startedAt = Date.now();
      recorder.start();
      store.setState({ status: "recording" });
      r.clock = setInterval(() => store.setState({ elapsed: Math.round((Date.now() - r.startedAt) / 1000) }), 1000);
    }
    catch (err) {
      if (r.generation !== generation)
        return;
      releaseMic();
      store.setState({ status: "idle", error: err instanceof DOMException && err.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in your browser settings, then try again." : err instanceof Error ? err.message : "Could not start recording." });
    }
  };
  const stop = () => { if (state.current.recorder?.state === "recording")
    state.current.recorder.stop(); };
  const toggleMute = () => {
    const stream = state.current.stream;
    if (!stream)
      return;
    const enabled = !stream.getAudioTracks()[0]?.enabled;
    stream.getAudioTracks().forEach(track => { track.enabled = enabled; });
    store.setState({ muted: !enabled });
  };
  const generateSpeech = async (text: string, voice: string) => {
    if (!text.trim())
      return;
    const r = state.current;
    const generation = r.generation;
    r.audio?.pause();
    store.setState({ error: "", status: "generating" });
    r.controller = new AbortController();
    try {
      const response = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }), signal: r.controller.signal });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Speech generation failed.");
      }
      const blob = await response.blob();
      if (r.generation !== generation)
        return;
      if (r.url)
        URL.revokeObjectURL(r.url);
      r.url = URL.createObjectURL(blob);
      store.setState({ audioUrl: r.url });
      const audio = new Audio(r.url);
      r.audio = audio;
      audio.onended = () => store.setState({ status: "idle" });
      audio.onpause = () => store.setState({ status: "idle" });
      audio.onplay = () => store.setState({ status: "speaking" });
      audio.onerror = () => { store.setState({ status: "idle", error: "Your browser could not play this audio. Try downloading it instead." }); };
      append("assistant", text, voice);
      try {
        await audio.play();
      }
      catch {
        store.setState({ status: "idle" });
      }
    }
    catch (err) {
      if (r.generation !== generation)
        return;
      store.setState({ error: err instanceof Error ? err.message : "Speech generation failed.", status: "idle" });
    }
  };
  const togglePlayback = () => { const audio = state.current.audio; if (!audio)
    return; if (audio.paused)
    void audio.play().catch(() => store.setState({ error: "Audio playback failed. Try downloading the audio." }));
  else
    audio.pause(); };
  return { ...session, start, stop, reset, toggleMute, generateSpeech, togglePlayback };
}
