"use client";

import type { CSSProperties } from "react";
import { useSessionStore } from "../stores/workspace-provider";
import type { WorkspaceMode } from "../stores/workspace-store";
import { Icon } from "./ui-icon";

export function VoiceOrb({ mode, animated }: { mode: WorkspaceMode; animated: boolean }) {
  const level = useSessionStore(mode, state => state.level);
  return <div className={`voice-orb-wrap ${animated ? "orb-active" : ""}`} style={{ "--audio-level": level } as CSSProperties} aria-hidden="true"><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /><div className="orb-ring ring-three" /><div className="voice-orb"><div className="orb-glow" /><div className="orb-sheen" /><div className="orb-lines">{Array.from({ length: 15 }, (_, i) => <span key={i} style={{ "--i": i } as CSSProperties} />)}</div><Icon name="wave" size={58} /></div><div className="orb-satellite satellite-one" /><div className="orb-satellite satellite-two" /></div>;
}

export function Waveform({ mode, recording }: { mode: WorkspaceMode; recording: boolean }) {
  const level = useSessionStore(mode, state => state.level);
  return <div className={`audio-wave ${recording ? "reactive" : ""}`} aria-hidden="true">{Array.from({ length: 49 }, (_, i) => <i key={i} style={{ "--bar-height": `${(6 + (Math.sin(i * 0.72) ** 2) * 22 * (1 - Math.abs(i - 24) / 30)).toFixed(2)}px`, "--live-height": `${(6 + level * (12 + Math.sin(i * 1.7) ** 2 * 40)).toFixed(2)}px`, "--delay": `${i * 0.025}s` } as CSSProperties} />)}</div>;
}
