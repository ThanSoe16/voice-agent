"use client";
import { useWatch } from "react-hook-form";
import type { Control, UseFormRegister } from "react-hook-form";
import type { AgentSettings } from "../lib/types";
import { fluxVoices, responseTones } from "../lib/types";
import { toneExpressivity } from "../lib/emotional-delivery";
import styles from "./emotional-delivery-settings.module.css";
import type { useVoicePreview } from "../lib/use-voice-preview";
import { VoicePreviewButton } from "./voice-preview-button";

export function EmotionalDeliverySettings({ control, register, preview }: { control: Control<AgentSettings>; register: UseFormRegister<AgentSettings>; preview: ReturnType<typeof useVoicePreview> }) {
  const enabled = useWatch({ control, name: "emotionalDelivery.enabled" });
  const mode = useWatch({ control, name: "emotionalDelivery.mode" });
  const tone = useWatch({ control, name: "emotionalDelivery.defaultTone" }) ?? "neutral";
  const manual = useWatch({ control, name: "emotionalDelivery.defaultExpressivity" }) ?? 0;
  const voice = useWatch({ control, name: "emotionalDelivery.voice" }) ?? "flux-kit-en";
  const value = mode === "automatic" ? toneExpressivity[tone] : manual;
  return <section className={styles.section} aria-label="Expressive TTS settings">
    <label className={styles.toggle}><span><strong>Expressive TTS</strong><small>Keep one speaker and adapt the way responses are delivered.</small></span><input type="checkbox" {...register("emotionalDelivery.enabled", { onChange: preview.stop })} role="switch" aria-label="Enable expressive TTS" /></label>
    {enabled && <>
      <label className={styles.row}><span>Flux voice</span><select {...register("emotionalDelivery.voice", { onChange: preview.stop })} aria-label="Expressive voice">{fluxVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>
      <label className={styles.row}><span>Delivery mode</span><select {...register("emotionalDelivery.mode", { onChange: preview.stop })} aria-label="Expressivity mode"><option value="automatic">Automatic tone</option><option value="manual">Manual register</option></select></label>
      <label className={styles.row}><span>Default tone</span><select {...register("emotionalDelivery.defaultTone", { onChange: preview.stop })} aria-label="Default response tone">{responseTones.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
      {mode === "manual" && <label className={styles.row}><span>Default expressivity</span><select {...register("emotionalDelivery.defaultExpressivity", { valueAsNumber: true, onChange: preview.stop })} aria-label="Default expressivity">{([-2, -1, 0, 1, 2] as const).map(item => <option key={item} value={item}>{item}{item === -2 ? " · Calm" : item === 0 ? " · Neutral" : item === 2 ? " · Animated" : ""}</option>)}</select></label>}
      <p className={styles.summary}>Session expressivity: <strong>{value}</strong>{mode === "automatic" ? ` · from ${tone} default tone` : " · manual"}</p>
      <VoicePreviewButton voice={voice} name={fluxVoices.find(item => item.id === voice)?.name ?? "expressive"} expressivity={value} preview={preview} />
      <p className={styles.help}>Automatic mode adapts wording and response tone during the conversation. Flux expressivity stays fixed for the session to preserve streaming. Start a new session to change its intensity.</p>
      <p className={styles.warning}>Nonzero expressivity is experimental. Use 0 for the production baseline and audition other values before use.</p>
      <p className={styles.help}>Your main Aura voice remains the fallback if Flux cannot speak.</p>
    </>}
  </section>;
}
