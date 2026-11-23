import { createStore } from "zustand/vanilla";
import { defaultSettings, voices } from "../lib/types";
import type { AgentSettings, Conversation } from "../lib/types";

export type WorkspaceMode = "lab" | "live";
export type WorkspaceView = "playground" | "history";
type WorkspaceDialog = "settings" | "help" | null;
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;

// Retain the original keys so existing sessions and preferences survive this refactor.
const HISTORY_KEY = "vocal.sessions.v1";
const SETTINGS_KEY = "vocal.settings.v1";

export function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Conversation;
  return typeof item.id === "string" && typeof item.title === "string"
    && typeof item.startedAt === "number" && Number.isFinite(item.startedAt)
    && typeof item.duration === "number" && Number.isFinite(item.duration)
    && typeof item.voice === "string" && Array.isArray(item.messages)
    && item.messages.every(message => message && typeof message.id === "string"
      && ["user", "assistant"].includes(message.role) && typeof message.content === "string"
      && typeof message.at === "number" && Number.isFinite(message.at));
}

export function isAgentSettings(value: unknown): value is AgentSettings {
  if (!value || typeof value !== "object") return false;
  const item = value as AgentSettings;
  return typeof item.name === "string" && typeof item.prompt === "string"
    && typeof item.greeting === "string" && voices.some(voice => voice.id === item.voice);
}

export type WorkspaceState = {
  view: WorkspaceView;
  mode: WorkspaceMode;
  settings: AgentSettings;
  sessions: Conversation[];
  hydrated: boolean;
  configured: boolean | null;
  dialog: WorkspaceDialog;
  selected: Conversation | null;
  notice: string;
  storageError: string;
  pendingDelete: Conversation | null;
  formRevision: number;
  hydrate: (storage?: WorkspaceStorage) => void;
  setView: (view: WorkspaceView) => void;
  changeMode: (mode: WorkspaceMode) => void;
  setSettings: (settings: AgentSettings) => void;
  saveSession: (session: Conversation) => void;
  openSession: (session: Conversation) => void;
  newSession: () => void;
  setConfigured: (configured: boolean | null) => void;
  setDialog: (dialog: WorkspaceDialog) => void;
  notify: (notice: string) => void;
  requestDelete: (session: Conversation | null) => void;
  deleteSession: (id: string) => void;
};

export function createWorkspaceStore() {
  let storage: WorkspaceStorage | undefined;
  const store = createStore<WorkspaceState>()((set, get) => ({
    view: "playground",
    mode: "lab",
    settings: { ...defaultSettings },
    sessions: [],
    hydrated: false,
    configured: null,
    dialog: null,
    selected: null,
    notice: "",
    storageError: "",
    pendingDelete: null,
    formRevision: 0,
    hydrate: suppliedStorage => {
      if (get().hydrated) return;
      const loaded: Partial<WorkspaceState> = { hydrated: true };
      try {
        storage = suppliedStorage ?? window.localStorage;
        const sessions: unknown = JSON.parse(storage.getItem(HISTORY_KEY) || "[]");
        if (Array.isArray(sessions)) loaded.sessions = sessions.filter(isConversation).slice(0, 100);
      } catch {
        loaded.storageError = "Browser history could not be read. Export transcripts to keep a copy.";
      }
      try {
        const settings: unknown = JSON.parse(storage?.getItem(SETTINGS_KEY) || "null");
        if (isAgentSettings(settings)) loaded.settings = settings;
      } catch {
        loaded.storageError = "Saved preferences could not be read. You can configure your agent again.";
      }
      set(loaded);
    },
    setView: view => set({ view }),
    changeMode: mode => set(state => ({ mode, selected: null, formRevision: state.formRevision + 1 })),
    setSettings: settings => set({ settings: { ...settings } }),
    saveSession: session => set(state => ({
      sessions: [{ ...session, messages: [...session.messages] }, ...state.sessions.filter(item => item.id !== session.id)].slice(0, 100),
    })),
    openSession: selected => set({ selected, view: "playground" }),
    newSession: () => set(state => ({ selected: null, view: "playground", formRevision: state.formRevision + 1 })),
    setConfigured: configured => set({ configured }),
    setDialog: dialog => set({ dialog }),
    notify: notice => set({ notice }),
    requestDelete: pendingDelete => set({ pendingDelete }),
    deleteSession: id => set(state => ({
      sessions: state.sessions.filter(session => session.id !== id),
      selected: state.selected?.id === id ? null : state.selected,
      pendingDelete: null,
      notice: "Session deleted",
    })),
  }));

  // Persist only durable data, and only when that data changes. Audio levels,
  // dialogs, and connection updates never serialize the conversation history.
  store.subscribe((state, previous) => {
    if (!storage || !state.hydrated || !previous.hydrated) return;
    try {
      if (state.sessions !== previous.sessions) storage.setItem(HISTORY_KEY, JSON.stringify(state.sessions));
      if (state.settings !== previous.settings) storage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {
      store.setState({ storageError: "Your browser could not save this session. Export the transcript to keep a copy." });
    }
  });
  return store;
}
