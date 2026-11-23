import { createStore } from "zustand/vanilla";
import type { Message } from "../lib/types";

export type LabStatus = "idle" | "recording" | "processing" | "generating" | "speaking";
export type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking";
export type SessionStatus = LabStatus | VoiceStatus;

export type SessionState<Status extends SessionStatus = SessionStatus> = {
  status: Status;
  messages: Message[];
  error: string;
  elapsed: number;
  muted: boolean;
  level: number;
  latency: number | null;
  audioUrl: string;
};

export function createSessionStore<Status extends SessionStatus>() {
  return createStore<SessionState<Status>>()(() => ({
    status: "idle" as Status,
    messages: [],
    error: "",
    elapsed: 0,
    muted: false,
    level: 0,
    latency: null,
    audioUrl: "",
  }));
}

// The page subscribes to infrequent session changes. The visualizer subscribes
// directly to level, keeping microphone animation out of the page render cycle.
export function selectSessionView<Status extends SessionStatus>(state: SessionState<Status>) {
  const { status, messages, error, elapsed, muted, latency, audioUrl } = state;
  return { status, messages, error, elapsed, muted, latency, audioUrl };
}
