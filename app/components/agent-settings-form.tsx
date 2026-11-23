"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { useWorkspaceStore } from "../stores/workspace-provider";
import { isAgentSettings } from "../stores/workspace-store";
import type { AgentSettings } from "../lib/types";
import { voices } from "../lib/types";
import { Icon } from "./ui-icon";

export function AgentSettingsForm({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  const settings = useWorkspaceStore(state => state.settings);
  const saveSettings = useWorkspaceStore(state => state.setSettings);
  const { register, control, subscribe, handleSubmit, formState: { errors } } = useForm<AgentSettings>({
    defaultValues: settings,
    mode: "onBlur",
  });

  useEffect(() => subscribe({
    formState: { values: true },
    callback: ({ values }) => {
      if (!busy && isAgentSettings(values) && values.name.trim() && values.name.length <= 60
        && values.greeting.length <= 500 && values.prompt.trim() && values.prompt.length <= 10000) {
        saveSettings(values);
      }
    },
  }), [subscribe, saveSettings, busy]);

  return <form onSubmit={handleSubmit(values => { if (!busy) saveSettings(values); onClose(); })} noValidate>
    <p className="modal-intro">A few small choices. A whole different conversation.</p>
    <fieldset disabled={busy} className="settings-fields">
      <label className="field-label">Agent name
        <input {...register("name", { validate: value => Boolean(value.trim()) || "Give your agent a name.", maxLength: { value: 60, message: "Use 60 characters or fewer." } })} maxLength={60} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "agent-name-error" : undefined} />
        {errors.name && <span className="field-error" id="agent-name-error" role="alert">{errors.name.message}</span>}
      </label>
      <div className="field-label">Choose a voice<span className="field-help">Deepgram Aura-2 · English</span></div>
      <Controller name="voice" control={control} rules={{ validate: value => voices.some(voice => voice.id === value) || "Select an available voice." }} render={({ field }) => <div className="voice-options" role="group" aria-label="Agent voice">
        {voices.map((voice, index) => <button type="button" className={`voice-option ${field.value === voice.id ? "chosen" : ""}`} key={voice.id} aria-pressed={field.value === voice.id} ref={index === 0 ? field.ref : undefined} onBlur={field.onBlur} onClick={() => field.onChange(voice.id)}>
          <span className="voice-option-avatar"><Icon name="wave" size={20} /></span>
          <span><strong>{voice.name}</strong><small>{voice.detail}</small></span>
          <span className="radio-circle">{field.value === voice.id && <span />}</span>
        </button>)}
      </div>} />
      <div className="settings-divider"><span>LIVE AGENT BEHAVIOR</span></div>
      <label className="field-label">First words<span className="field-help">What your live agent says when a conversation starts.</span>
        <textarea {...register("greeting", { maxLength: { value: 500, message: "Use 500 characters or fewer." } })} maxLength={500} rows={3} />
      </label>
      <label className="field-label">Agent instructions<span className="field-help">Give your agent a role, a tone, and a little direction.</span>
        <textarea {...register("prompt", { validate: value => Boolean(value.trim()) || "Add instructions for your agent.", maxLength: { value: 10000, message: "Use 10,000 characters or fewer." } })} maxLength={10000} rows={5} aria-invalid={Boolean(errors.prompt)} aria-describedby={errors.prompt ? "agent-prompt-error" : undefined} />
        {errors.prompt && <span className="field-error" id="agent-prompt-error" role="alert">{errors.prompt.message}</span>}
      </label>
    </fieldset>
    <div className="settings-note"><Icon name="shield" size={17} /><p>{busy ? "End your current session to change settings." : "Preferences are saved automatically in this browser. Changes apply to your next session."}</p></div>
    {busy ? <button type="button" className="button button-purple settings-done" onClick={onClose}><Icon name="check" size={17} />Done</button> : <button type="submit" className="button button-purple settings-done"><Icon name="check" size={17} />Done</button>}
  </form>;
}
