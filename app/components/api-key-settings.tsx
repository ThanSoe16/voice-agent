"use client";

import { useEffect, useRef, useState } from "react";
import { useCredentialsStore, useWorkspaceStore } from "../stores/workspace-provider";
import { Icon } from "./ui-icon";
import styles from "./api-key-settings.module.css";

export function ApiKeySettings({ busy, autoFocus = false }: { busy: boolean; autoFocus?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const apiKey = useCredentialsStore(state => state.apiKey);
  const setApiKey = useCredentialsStore(state => state.setApiKey);
  const hydrated = useWorkspaceStore(state => state.hydrated);
  const configured = Boolean(apiKey);
  const [draft, setDraft] = useState(apiKey);
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  function save(value: string) {
    if (busy) return;
    const key = value.trim();
    if (key && (/\s/.test(key) || key.length > 512)) {
      setError("Enter a valid API key without spaces.");
      return;
    }
    try {
      setApiKey(key);
      setDraft(key);
      setError("");
      setNotice(key ? "API key saved. It will be used for your next request." : "API key removed. Add a key to use voice features again.");
    } catch {
      setError("Your browser could not update the saved API key. This change applies only for this visit.");
    }
  }

  return <section className={styles.section} aria-label="Deepgram connection">
    <label className={styles.label} htmlFor="deepgram-api-key">Deepgram API key
      <span className={styles.help}>Use a key with Member or higher permissions for Live Agent.</span>
    </label>
    <div className={`${styles.status} ${!configured ? styles.pending : ""}`} role="status">
      <Icon name={configured ? "shield" : "info"} size={18} />
      <div>
        <strong>{apiKey ? "API key configured" : hydrated ? "API key required" : "Loading saved key…"}</strong>
        <p>{apiKey ? "Your saved settings key is used for all voice requests." : "Add a key below to use Speech Lab and Live Agent."}</p>
      </div>
    </div>
    <div className={styles.inputRow}>
      <input ref={input} className={styles.input} id="deepgram-api-key" type={visible ? "text" : "password"} value={draft} onChange={event => { setDraft(event.target.value); setNotice(""); setError(""); }} disabled={busy} placeholder="Paste your Deepgram API key" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={512} aria-describedby="deepgram-key-help" aria-invalid={Boolean(error)} />
      <button type="button" className={styles.visibility} onClick={() => setVisible(value => !value)} aria-label={visible ? "Hide API key" : "Show API key"} aria-pressed={visible}>{visible ? "Hide" : "Show"}</button>
    </div>
    <p className={styles.help} id="deepgram-key-help">Stored in this browser and used for all voice features.</p>
    <div className={styles.actions}>
      <button type="button" className={`button button-purple ${styles.save}`} disabled={busy || !draft.trim()} onClick={() => save(draft)}>Save API key</button>
      {apiKey && <button type="button" className={styles.remove} disabled={busy} onClick={() => save("")}>Remove saved key</button>}
    </div>
    {notice && <p className={styles.help} role="status">{notice}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </section>;
}
