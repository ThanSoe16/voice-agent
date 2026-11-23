"use client";

import { useForm, useWatch } from "react-hook-form";
import { useWorkspaceStore } from "../stores/workspace-provider";
import type { Conversation } from "../lib/types";
import { durationLabel } from "../lib/types";
import { dateLabel, downloadSession, voiceLabel } from "../lib/conversations";
import { Icon } from "./ui-icon";

export function HistoryView({ busy, onNewSession, onOpenSession }: { busy: boolean; onNewSession: () => void; onOpenSession: (session: Conversation) => void }) {
  const sessions = useWorkspaceStore(state => state.sessions);
  const setPendingDelete = useWorkspaceStore(state => state.requestDelete);
  const { register, control, reset } = useForm({ defaultValues: { query: "" } });
  const query = useWatch({ control, name: "query" });
  const historyMatches = sessions.filter(session => `${session.title} ${session.messages.map(message => message.content).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const totalDuration = sessions.reduce((total, session) => total + session.duration, 0);
  return <>
          <div className="history-stats"><div><span>Total sessions</span><strong>{sessions.length.toString().padStart(2, "0")}</strong><Icon name="history" /></div><div><span>Time spent exploring</span><strong>{durationLabel(totalDuration)}</strong><Icon name="clock" /></div><div><span>Messages exchanged</span><strong>{sessions.reduce((count, session) => count + session.messages.length, 0).toString().padStart(2, "0")}</strong><Icon name="chat" /></div></div>
          <section className="history-panel"><div className="history-heading"><h2>All sessions <span>{sessions.length}</span></h2><div className="search-field"><Icon name="search" size={17} /><input aria-label="Search sessions" placeholder="Search your conversations…" {...register("query")} /></div></div><div className="history-table-wrap"><table className="history-table"><thead><tr><th>Conversation</th><th>Date</th><th>Duration</th><th>Messages</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{historyMatches.map(session => <tr key={session.id}><td><button className="session-title" onClick={() => onOpenSession(session)} disabled={busy}><span className="recent-icon"><Icon name={session.mode === "lab" ? "mic" : "chat"} size={17} /></span><span>{session.title}<small>{session.mode === "lab" ? "Speech lab" : "Live agent"} · {voiceLabel(session.voice)}</small></span></button></td><td>{dateLabel(session.startedAt)}</td><td className="mono">{durationLabel(session.duration)}</td><td>{session.messages.length}</td><td><div className="table-actions"><button className="icon-button" onClick={() => downloadSession(session)} aria-label={`Export ${session.title}`}><Icon name="download" size={17} /></button><button className="icon-button" onClick={() => setPendingDelete(session)} disabled={busy} aria-label={`Delete ${session.title}`}><Icon name="trash" size={17} /></button></div></td></tr>)}</tbody></table></div>{!historyMatches.length && <div className="history-empty"><span className="empty-chat-icon"><Icon name="history" size={29} /></span><h3>{query ? "No matching conversations" : "Your story starts with a hello."}</h3><p>{query ? "Try a different word or phrase." : "Your saved sessions will live here. Head to the playground to start your first one."}</p><button className="button button-purple" onClick={() => query ? reset() : onNewSession()}>{query ? "Clear search" : "Open playground"}</button></div>}</section>
  </>;
}
