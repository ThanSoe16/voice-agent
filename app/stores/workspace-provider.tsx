"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { createWorkspaceStore } from "./workspace-store";
import type { WorkspaceMode, WorkspaceState } from "./workspace-store";
import { createSessionStore } from "./session-store";
import type { LabStatus, SessionState, VoiceStatus } from "./session-store";

type Stores = {
  workspace: ReturnType<typeof createWorkspaceStore>;
  lab: StoreApi<SessionState<LabStatus>>;
  live: StoreApi<SessionState<VoiceStatus>>;
};
const WorkspaceContext = createContext<Stores | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Stores | null>(null);
  if (!ref.current) {
    ref.current = {
      workspace: createWorkspaceStore(),
      lab: createSessionStore<LabStatus>(),
      live: createSessionStore<VoiceStatus>(),
    };
  }
  const stores = ref.current;
  useEffect(() => {
    stores.workspace.getState().hydrate();
    const controller = new AbortController();
    void fetch("/api/deepgram/token", { signal: controller.signal })
      .then(response => response.json())
      .then(data => stores.workspace.getState().setConfigured(data.configured === true))
      .catch(() => { if (!controller.signal.aborted) stores.workspace.getState().setConfigured(null); });
    return () => controller.abort();
  }, [stores]);
  return <WorkspaceContext.Provider value={stores}>{children}</WorkspaceContext.Provider>;
}

function useStores() {
  const stores = useContext(WorkspaceContext);
  if (!stores) throw new Error("Workspace hooks must be used inside WorkspaceProvider.");
  return stores;
}

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T) {
  return useStore(useStores().workspace, selector);
}

export function useSessionStore<T>(mode: WorkspaceMode, selector: (state: SessionState) => T) {
  return useStore(useStores()[mode] as StoreApi<SessionState>, selector);
}

export function useLabSessionApi() { return useStores().lab; }
export function useVoiceSessionApi() { return useStores().live; }
