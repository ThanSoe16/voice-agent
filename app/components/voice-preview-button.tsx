"use client";

import type { Expressivity } from "../lib/types";
import { useVoicePreview, voicePreviewKey } from "../lib/use-voice-preview";
import { Icon } from "./ui-icon";
import styles from "./voice-preview-button.module.css";

export function VoicePreviewButton({ voice, name, expressivity, preview }: {
  voice: string; name: string; expressivity?: Expressivity; preview: ReturnType<typeof useVoicePreview>;
}) {
  const state = preview.state?.key === voicePreviewKey(voice, expressivity) ? preview.state : null;
  const active = state?.status === "loading" || state?.status === "playing";
  return <div className={styles.preview}>
    <button type="button" className={styles.button} disabled={!preview.hasApiKey}
      onClick={() => active ? preview.stop() : void preview.play(voice, expressivity)}>
      <Icon name={active ? "stop" : "play"} size={15} />
      {state?.status === "loading" ? "Cancel preview" : state?.status === "playing" ? "Stop preview" : `Test ${name} voice`}
    </button>
    <span className={styles.status} role="status">{!preview.hasApiKey ? "Save an API key above to hear a sample." : state?.status === "loading" ? "Preparing your sample…" : state?.status === "playing" ? `Playing ${name}${expressivity !== undefined ? ` · expressivity ${expressivity}` : ""}` : ""}</span>
    {state?.error && <p className={styles.error} role="alert">{state.error}</p>}
  </div>;
}
