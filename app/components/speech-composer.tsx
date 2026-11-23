"use client";

import { useForm, useWatch } from "react-hook-form";
import { voiceLabel } from "../lib/conversations";
import type { LabStatus } from "../stores/session-store";
import { Icon } from "./ui-icon";

type Props = {
  lastTranscript: string;
  voice: string;
  busy: boolean;
  status: LabStatus;
  audioUrl: string;
  onGenerate: (text: string, voice: string) => Promise<void>;
  onTogglePlayback: () => void;
};

export function SpeechComposer({ lastTranscript, voice, busy, status, audioUrl, onGenerate, onTogglePlayback }: Props) {
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { text: "" } });
  const text = useWatch({ control, name: "text" });
  const generatedText = text || lastTranscript;
  return <form onSubmit={handleSubmit(() => onGenerate(generatedText, voice))} noValidate>
    <div className="composer-label"><Icon name="volume" size={15} /><span>TEXT TO SPEECH</span><span>{generatedText.length}/1,000</span></div>
    <textarea {...register("text", { validate: value => {
      const candidate = value || lastTranscript;
      return Boolean(candidate.trim()) && candidate.length <= 1000 || "Enter up to 1,000 characters to generate speech.";
    } })} aria-label="Text to turn into speech" placeholder="Type something, or record your voice above…" maxLength={1000} disabled={busy} aria-invalid={Boolean(errors.text)} />
    {errors.text && <p className="field-error" role="alert">{errors.text.message}</p>}
    <div className="composer-bottom"><span>{lastTranscript && !text ? "Using your latest transcript" : `${voiceLabel(voice)} · English`}</span><button type="submit" className="button button-purple small-button" disabled={!generatedText.trim() || generatedText.length > 1000 || busy || isSubmitting}><Icon name="play" size={13} />Generate speech</button></div>
    {audioUrl && <div className="audio-result"><button type="button" className="icon-button" onClick={onTogglePlayback} aria-label={status === "speaking" ? "Pause generated audio" : "Play generated audio"}><Icon name={status === "speaking" ? "pause" : "play"} size={16} /></button><span>Generated audio<small>{voiceLabel(voice)} · MP3</small></span><a className="icon-button" href={audioUrl} download="vocal-speech.mp3" aria-label="Download generated audio"><Icon name="download" size={17} /></a></div>}
  </form>;
}

export function LiveComposer({ recording, onSend }: { recording: boolean; onSend: (text: string) => boolean }) {
  const { register, control, handleSubmit, reset } = useForm({ defaultValues: { message: "" } });
  const message = useWatch({ control, name: "message" });
  return <form onSubmit={handleSubmit(values => { if (onSend(values.message)) reset(); })}>
    <div className="live-input"><input {...register("message", { validate: value => Boolean(value.trim()), maxLength: 2000 })} aria-label="Send a text message to the agent" placeholder="Or type a message to your agent…" disabled={!recording} maxLength={2000} /><button className="icon-button" type="submit" disabled={!recording || !message.trim()} aria-label="Send message"><Icon name="send" size={17} /></button></div>
    <span className="input-hint">{recording ? "Press Enter to send · Your microphone stays active" : "Start a conversation to enable text messages"}</span>
  </form>;
}
