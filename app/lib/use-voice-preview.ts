"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCredentialsStore } from "../stores/workspace-provider";
import { deepgramRequestHeaders } from "./deepgram-request";
import type { Expressivity } from "./types";

export function voicePreviewKey(voice: string, expressivity?: Expressivity) {
  return `${voice}:${expressivity ?? 0}`;
}

export function useVoicePreview() {
  const apiKey = useCredentialsStore(state => state.apiKey);
  const [state, setState] = useState<{ key: string; status: "loading" | "playing" | "error"; error?: string } | null>(null);
  const runtime = useRef<{ generation: number; controller?: AbortController; audio?: HTMLAudioElement; url?: string }>({ generation: 0 });
  const release = useCallback(() => {
    const r = runtime.current;
    r.generation++;
    r.controller?.abort();
    if (r.audio) {
      r.audio.onended = null;
      r.audio.onerror = null;
      r.audio.pause();
      r.audio.removeAttribute("src");
    }
    if (r.url) URL.revokeObjectURL(r.url);
    r.controller = undefined;
    r.audio = undefined;
    r.url = undefined;
  }, []);
  const stop = useCallback(() => { release(); setState(null); }, [release]);
  useEffect(() => release, [release, apiKey]);

  const play = async (voice: string, expressivity?: Expressivity) => {
    release();
    const key = voicePreviewKey(voice, expressivity);
    if (!apiKey) { setState({ key, status: "error", error: "Save a Deepgram API key above to test voices." }); return; }
    const r = runtime.current;
    const generation = r.generation;
    const current = () => generation === r.generation;
    const controller = new AbortController();
    r.controller = controller;
    setState({ key, status: "loading" });
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deepgramRequestHeaders(apiKey) },
        body: JSON.stringify({ voice, expressivity, text: "Hello! This is a preview of my voice. I'm here to listen and help. What would you like to talk about?" }),
        signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Could not generate the voice sample.");
      }
      const blob = await response.blob();
      if (!current()) return;
      r.url = URL.createObjectURL(blob);
      const audio = new Audio(r.url);
      r.audio = audio;
      audio.onended = () => { if (current()) stop(); };
      audio.onerror = () => {
        if (!current()) return;
        release();
        setState({ key, status: "error", error: "Your browser could not play this sample. Try again." });
      };
      await audio.play();
      if (current()) setState({ key, status: "playing" });
    } catch (error) {
      if (!current()) return;
      release();
      setState({ key, status: "error", error: error instanceof Error ? error.message : "Could not play the voice sample." });
    }
  };
  return { state, play, stop, hasApiKey: Boolean(apiKey) };
}
