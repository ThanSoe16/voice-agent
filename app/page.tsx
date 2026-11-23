"use client";

import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "./components/ui-icon";
import type { Conversation, Message } from "./lib/types";
import { durationLabel } from "./lib/types";
import { dateLabel, downloadSession, voiceLabel } from "./lib/conversations";
import { WorkspaceProvider, useWorkspaceStore } from "./stores/workspace-provider";
import { AgentSettingsForm } from "./components/agent-settings-form";
import { SpeechComposer, LiveComposer } from "./components/speech-composer";
import { HistoryView } from "./components/history-view";
import { VoiceOrb, Waveform } from "./components/voice-visualizer";
import { useVoiceAgent } from "./lib/use-voice-agent";
import { useSpeechLab } from "./lib/use-speech-lab";

const exampleMessages: Message[] = [
  { id: "example-1", role: "assistant", content: "Hey there! I'm your AI voice assistant. What would you like to talk about today?", at: 0 },
  { id: "example-2", role: "user", content: "I'm testing a voice assistant for my coffee shop. Can you help a customer pick a drink?", at: 5000 },
  { id: "example-3", role: "assistant", content: "Of course! Let's find your next favorite. Do you like something rich and bold, or light and a little sweet?", at: 11000 },
  { id: "example-4", role: "user", content: "Something light, and I prefer oat milk.", at: 18000 },
  { id: "example-5", role: "assistant", content: "An iced oat milk latte sounds perfect. A touch of vanilla makes it a little sweet without overpowering the coffee.", at: 24000 },
];


function Modal({ children, title, onClose, sheet = false }: { children: React.ReactNode; title: string; onClose: () => void; sheet?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={sheet ? "modal settings-sheet" : "modal"} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-head"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

export default function Home() {
  return <WorkspaceProvider><Workspace /></WorkspaceProvider>;
}

function Workspace() {
  const {
    view, mode, settings, sessions, configured, dialog, selected, notice, storageError,
    pendingDelete, formRevision, setView, setDialog, setNotice, setPendingDelete,
    startNewSession, selectMode, selectSession, deleteSession,
  } = useWorkspaceStore(useShallow(state => ({
    view: state.view, mode: state.mode, settings: state.settings, sessions: state.sessions,
    configured: state.configured, dialog: state.dialog, selected: state.selected,
    notice: state.notice, storageError: state.storageError, pendingDelete: state.pendingDelete,
    formRevision: state.formRevision, setView: state.setView, setDialog: state.setDialog,
    setNotice: state.notify, setPendingDelete: state.requestDelete, startNewSession: state.newSession,
    selectMode: state.changeMode, selectSession: state.openSession, deleteSession: state.deleteSession,
  })));
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const voice = useVoiceAgent();
  const lab = useSpeechLab();
  const active = mode === "live" ? voice : lab;
  const busy = active.status !== "idle";
  const recording = mode === "lab" ? lab.status === "recording" : voice.status !== "idle" && voice.status !== "connecting";
  const processing = ["processing", "generating", "connecting"].includes(active.status);
  const messages = selected?.messages || active.messages;
  const statusTitle = selected ? selected.demo ? "A little inspiration" : "Session complete" : ({ idle: "Let's hear your ideas.", recording: "I'm all ears.", processing: "Turning sound into words…", generating: "Finding your voice…", speaking: "Sounds like a conversation.", connecting: "Making a connection…", listening: "I'm listening.", thinking: "A moment to think…" }[active.status]);
  const statusHint = selected ? selected.demo ? "An example of what's possible with your voice agent." : "Your conversation, ready to revisit." : ({ idle: mode === "lab" ? "Your voice. Transcribed, then brought back to life." : "A natural conversation starts with a simple hello.", recording: "Speak naturally. Stop recording when you're done.", processing: "Deepgram is transcribing your recording.", generating: "Deepgram is creating your audio.", speaking: "Listen to the voice you've made your own.", connecting: "Connecting securely to your Deepgram agent.", listening: "Speak naturally. Your agent is ready to help.", thinking: "Your agent is putting a response together." }[active.status]);
  const lastTranscript = [...lab.messages].reverse().find(message => message.role === "user")?.content || "";
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(""), 3500); return () => clearTimeout(timeout); }, [notice]);

  function newSession() { voice.reset(); lab.reset(); startNewSession(); }
  function changeMode(next: "lab" | "live") { if (!busy) selectMode(next); }
  function openSession(session: Conversation) { if (!busy) selectSession(session); }
  function sample() { openSession({ id: "example", title: "A coffee shop conversation", startedAt: Date.now(), duration: 32, messages: exampleMessages, voice: "aura-2-thalia-en", mode: "live", demo: true }); }
  async function copyTranscript() {
    try { await navigator.clipboard.writeText(messages.map(message => `${message.role === "user" ? "You" : "Agent"}: ${message.content}`).join("\n\n")); setNotice("Transcript copied to clipboard"); }
    catch { setNotice("Clipboard unavailable. Use Export to save your transcript."); }
  }
  function exportCurrent() {
    if (selected) downloadSession(selected);
    else downloadSession({ id: "current", title: "Voice playground session", startedAt: Date.now(), duration: active.elapsed, voice: settings.voice, messages, mode });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Vocal home"><span className="brand-mark"><Icon name="wave" size={25} /></span>vocal<span className="brand-period">.</span></a>
      <div className="workspace-switch"><span className="workspace-avatar">M</span><div>My workspace<small>Personal workspace</small></div><Icon name="down" size={15} /></div>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${view === "playground" ? "active" : ""}`} onClick={() => setView("playground")}><Icon name="wave" />Playground<span className="nav-active-dot" /></button>
        <button className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}><Icon name="history" />Session history<span className="nav-count">{sessions.length}</span></button>
        <button className="nav-item" onClick={() => setDialog("settings")}><Icon name="settings" />Agent settings</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-tip"><span className="tip-icon"><Icon name="sparkles" size={19} /></span><h3>From hello to what&apos;s next.</h3><p>A space to experiment, listen, and make your agent feel more human.</p><button onClick={() => { setView("playground"); sample(); }} disabled={busy}>Explore an example<Icon name="play" size={14} /></button></div>
        <a className="nav-item docs-link" href="https://developers.deepgram.com/docs/voice-agent" target="_blank" rel="noreferrer"><Icon name="book" />Documentation<Icon name="external" size={15} /></a>
        <div className="sidebar-profile"><span className="profile-avatar">Y</span><div>Your workspace<small>Local development</small></div><span className="local-tag">LOCAL</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={13} /><strong>{view === "history" ? "Session history" : "Playground"}</strong></div><div className="topbar-actions"><span className={`connection-pill ${configured === false ? "not-configured" : ""}`}><span className={voice.status !== "idle" && voice.status !== "connecting" ? "status-dot pulse" : "status-dot"} />{voice.status !== "idle" && voice.status !== "connecting" ? "Agent connected" : configured === true ? "API key configured" : configured === false ? "API key needed" : "Checking connection"}</span><button className="icon-button help-button" onClick={() => setDialog("help")} aria-label="How Vocal works"><Icon name="info" size={19} /></button><span className="top-avatar">Y</span></div></header>
      <main className="main-content">
        <div className="page-heading"><div><div className="eyebrow heading-eyebrow"><span />THE VOICE WORKSPACE</div><h1>{view === "history" ? "Every conversation, kept." : "Good conversations start here."}</h1><p>{view === "history" ? "Revisit your tests, find the details, and keep improving." : "Talk to your agent. Try something new. Make every interaction better."}</p></div><button className="button button-dark" onClick={newSession}><Icon name="plus" size={18} />New session</button></div>

        {(storageError || active.error) && <div className="error-banner" role="alert"><Icon name="info" size={19} /><span>{active.error || storageError}</span></div>}

        {view === "playground" ? <>
          <div className="playground-toolbar"><div className="mode-tabs" role="tablist" aria-label="Testing mode"><button role="tab" aria-selected={mode === "lab"} className={mode === "lab" ? "selected" : ""} onClick={() => changeMode("lab")} disabled={busy}><Icon name="mic" size={17} />Speech lab</button><button role="tab" aria-selected={mode === "live"} className={mode === "live" ? "selected" : ""} onClick={() => changeMode("live")} disabled={busy}><Icon name="sparkles" size={17} />Live agent<span className="beta-tag">LIVE</span></button></div><span className="save-note"><Icon name="shield" size={15} />History saved in this browser</span></div>

          <div className="playground-grid">
            <section className={`voice-panel ${recording || active.status === "speaking" ? "is-active" : ""}`} aria-label="Voice controls">
              <div className="panel-topline"><span className="section-label"><Icon name="wave" size={17} />{selected ? selected.demo ? "EXAMPLE SESSION" : "SAVED SESSION" : mode === "live" ? "VOICE AGENT" : "VOICE PLAYGROUND"}</span><span className={`state-badge ${recording ? "live" : ""}`}><span />{selected ? "Preview" : recording ? mode === "lab" ? "Recording" : "Connected" : processing ? "Processing" : active.status === "speaking" ? "Speaking" : "Ready to test"}</span></div>
              <div className="voice-stage">
                <VoiceOrb mode={mode} animated={recording || active.status === "speaking"} />
                <h2>{statusTitle}</h2><p>{statusHint}</p>
                <Waveform mode={mode} recording={recording} />
                <div className="voice-controls">
                  <button className={`round-control ${active.muted ? "muted" : ""}`} onClick={active.toggleMute} disabled={!recording || Boolean(selected)} aria-label={active.muted ? "Unmute microphone" : "Mute microphone"} title={active.muted ? "Unmute microphone" : "Mute microphone"}><Icon name={active.muted ? "muted" : "mic"} size={19} /></button>
                  <button className={`button start-button ${recording ? "stop-button" : ""}`} disabled={processing} onClick={() => { if (selected) { newSession(); return; } if (recording || (mode === "live" && busy)) active.stop(); else if (mode === "live") void voice.start(settings); else void lab.start(settings.voice); }}><Icon name={processing ? "wave" : recording ? "stop" : "mic"} size={19} />{selected ? "Start your own session" : processing ? "Please wait…" : recording ? mode === "lab" ? "Stop recording" : "End conversation" : mode === "lab" ? "Start recording" : "Start conversation"}</button>
                  <button className="round-control" onClick={() => setDialog("settings")} aria-label="Configure voice and agent" title="Configure voice and agent" disabled={busy}><Icon name="settings" size={19} /></button>
                </div>
                <span className="stage-footnote">{selected ? "No microphone is active in this preview" : recording ? "Your microphone is active" : mode === "lab" ? "Record a thought. We'll take it from there." : "Microphone access is requested when you start"}</span>
              </div>
              <div className="session-metrics"><div><span><Icon name="clock" size={14} />Duration</span><strong>{durationLabel(selected?.duration ?? active.elapsed)}</strong></div><div><span><Icon name="chat" size={14} />Messages</span><strong>{messages.length.toString().padStart(2, "0")}</strong></div><div><span><Icon name="bolt" size={14} />{mode === "lab" ? "Transcription" : "Response"}</span><strong>{!selected && active.latency !== null ? <>{(active.latency / 1000).toFixed(2)}<small>s</small></> : <span className="metric-dash">—</span>}</strong></div></div>
            </section>

            <section className="transcript-panel" aria-label="Conversation transcript"><div className="transcript-header"><div><Icon name="chat" size={18} /><h2>{selected?.demo ? "Example transcript" : "Conversation"}</h2>{messages.length > 0 && <span className="message-count">{messages.length}</span>}</div><div><button className="icon-button" disabled={!messages.length} onClick={() => void copyTranscript()} aria-label="Copy transcript" title="Copy transcript"><Icon name="copy" size={17} /></button><button className="icon-button" disabled={!messages.length} onClick={exportCurrent} aria-label="Export transcript" title="Export transcript"><Icon name="download" size={18} /></button></div></div>
              {selected && <div className="transcript-notice"><Icon name={selected.demo ? "info" : "history"} size={14} />{selected.demo ? "Sample conversation · for inspiration only" : `${selected.title} · ${dateLabel(selected.startedAt)}`}</div>}
              <div className={`transcript-body ${!messages.length ? "is-empty" : ""}`} role="log" aria-label="Conversation messages" aria-live="polite">
                {messages.length ? messages.map(message => <div className={`message message-${message.role}`} key={message.id}><span className={`message-avatar ${message.role === "assistant" ? "agent-avatar" : ""}`}>{message.role === "assistant" ? <Icon name="wave" size={16} /> : "Y"}</span><div className="message-main"><div className="message-meta"><strong>{message.role === "user" ? "You" : selected?.demo ? "Voice agent" : mode === "lab" && !selected ? "Voice playback" : settings.name}</strong><span>{selected?.demo ? durationLabel(message.at / 1000) : new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><p>{message.content}</p>{message.role === "assistant" && mode === "lab" && !selected && <span className="playback-label"><Icon name="volume" size={12} />Generated with {voiceLabel(settings.voice)}</span>}</div></div>) : <div className="empty-transcript"><div className="empty-chat-icon"><Icon name="chat" size={26} /><span><Icon name="sparkles" size={13} /></span></div><h3>A blank page. A new possibility.</h3><p>{mode === "lab" ? "Your words will appear here after each recording. Listen back in a whole new voice." : "Start talking and follow the conversation here, one thought at a time."}</p><div className="empty-transcript-line" /><span className="tiny-label">NEED A LITTLE INSPIRATION?</span><button className="suggestion" onClick={sample} disabled={busy}><Icon name="headphones" size={15} /><span>Explore a coffee shop conversation</span><Icon name="chevron" size={14} /></button></div>}
                {processing && <div className="processing-message"><span className="typing-dots"><i /><i /><i /></span>{mode === "lab" && lab.status === "generating" ? "Creating your audio" : mode === "lab" ? "Listening for your words" : "Connecting to your agent"}</div>}<div ref={transcriptEnd} />
              </div>
              <div className="transcript-composer">{mode === "lab" && !selected ? <SpeechComposer key={formRevision} lastTranscript={lastTranscript} voice={settings.voice} busy={busy} status={lab.status} audioUrl={lab.audioUrl} onGenerate={lab.generateSpeech} onTogglePlayback={lab.togglePlayback} /> : selected ? <div className="saved-transcript-footer"><Icon name="file" size={16} /><span>{selected.demo ? "Make it yours. Start a new session to try it." : "Saved locally, ready whenever you are."}</span></div> : <LiveComposer key={formRevision} recording={recording} onSend={voice.sendText} />}</div>
            </section>
          </div>

          <div className="agent-strip"><div className="agent-strip-title"><span className="agent-mini-avatar"><Icon name="wave" size={20} /></span><div><strong>{settings.name}</strong><span>Powered by Deepgram</span></div></div><div className="agent-strip-config"><span><span className="config-caption">VOICE</span>{voiceLabel(settings.voice)}</span><span><span className="config-caption">LANGUAGE</span>English</span><span><span className="config-caption">TRANSCRIPTION</span>Nova-3</span></div><button className="button button-outline small-button" onClick={() => setDialog("settings")} disabled={busy}><Icon name="settings" size={15} />Configure agent</button></div>

          <section className="recent-section"><div className="section-heading"><div><h2>Recent sessions</h2><span>Your experiments, all in one place.</span></div><button className="text-button" onClick={() => setView("history")}>View all sessions<Icon name="chevron" size={14} /></button></div>{sessions.length ? <div className="recent-grid">{sessions.slice(0, 3).map(session => <button className="recent-card" key={session.id} onClick={() => openSession(session)} disabled={busy}><span className="recent-icon"><Icon name={session.mode === "lab" ? "mic" : "chat"} size={18} /></span><div><h3>{session.title}</h3><span>{dateLabel(session.startedAt)}</span><div className="recent-meta"><span><Icon name="clock" size={12} />{durationLabel(session.duration)}</span><span>{session.messages.length} messages</span><span>{session.mode === "lab" ? "Speech lab" : "Live agent"}</span></div></div><Icon name="chevron" size={15} /></button>)}</div> : <div className="history-empty-inline"><span className="recent-icon"><Icon name="history" size={20} /></span><div><strong>Your first session is the start of something.</strong><p>Record or start a conversation. Your transcript will be saved here automatically.</p></div><span className="empty-history-tag">Ready when you are</span></div>}</section>
        </> : <>
          <HistoryView busy={busy} onNewSession={newSession} onOpenSession={openSession} />
        </>}
        <footer className="page-footer"><span><Icon name="shield" size={14} />Your space to experiment. History stays in this browser.</span><span>Built for better conversations<span className="footer-wave"><Icon name="wave" size={15} /></span></span></footer>
      </main>
    </div>

    {notice && <div className="toast" role="status"><Icon name="check" size={17} />{notice}</div>}
    {dialog === "settings" && <Modal title="Make the voice yours." sheet onClose={() => setDialog(null)}><AgentSettingsForm busy={busy} onClose={() => setDialog(null)} /></Modal>}
    {dialog === "help" && <Modal title="A playground for your voice." onClose={() => setDialog(null)}><p className="modal-intro">A simple space to test the pieces of a great conversation.</p><div className="help-item"><span><Icon name="mic" /></span><div><h3>Speech lab</h3><p>Record your voice, stop to transcribe it with Nova-3, then generate speech with an Aura-2 voice. You can also type your own text.</p></div></div><div className="help-item"><span><Icon name="sparkles" /></span><div><h3>Live agent</h3><p>Have a two-way voice conversation with Deepgram&apos;s Voice Agent API. Speak, interrupt, or send text while your agent listens.</p></div></div><div className="help-item"><span><Icon name="history" /></span><div><h3>Keep the useful parts</h3><p>Transcripts are saved in this browser. Copy or export them anytime. Audio is sent to Deepgram for processing; recordings are not saved in your history.</p></div></div><div className="setup-note"><strong>{configured ? "Your Deepgram API key is configured." : "Connect your Deepgram account"}</strong><p>Set <code>DEEPGRAM_API_KEY</code> in <code>.env.local</code>, then restart the server. Live Agent connections need a key with Member or higher permissions and Voice Agent access.</p></div><button className="button button-purple settings-done" onClick={() => setDialog(null)}>Got it</button></Modal>}
    {pendingDelete && <Modal title="Delete this session?" onClose={() => setPendingDelete(null)}><p className="modal-intro">“{pendingDelete.title}” will be removed from this browser. This cannot be undone.</p><div className="delete-actions"><button className="button button-outline" onClick={() => setPendingDelete(null)}>Keep session</button><button className="button button-danger" onClick={() => { deleteSession(pendingDelete.id); }}><Icon name="trash" size={16} />Delete session</button></div></Modal>}
  </div>;
}
