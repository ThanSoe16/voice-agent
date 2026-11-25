"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { createWorkspaceStore } from "./workspace-store";
import type { WorkspaceMode, WorkspaceState } from "./workspace-store";
import { createSessionStore } from "./session-store";
import type { LabStatus, SessionState, VoiceStatus } from "./session-store";
import { createCredentialsStore } from "./credentials-store";
import type { CredentialsState } from "./credentials-store";

type Stores = {
  workspace: ReturnType<typeof createWorkspaceStore>;
  credentials: ReturnType<typeof createCredentialsStore>;
  lab: StoreApi<SessionState<LabStatus>>;
  live: StoreApi<SessionState<VoiceStatus>>;
};
const WorkspaceContext = createContext<Stores | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [stores] = useState<Stores>(() => ({
    workspace: createWorkspaceStore(),
    credentials: createCredentialsStore(),
    lab: createSessionStore<LabStatus>(),
    live: createSessionStore<VoiceStatus>(),
  }));
  useEffect(() => {
    // Resolve saved credentials before marking the workspace ready, including
    // when browser storage is unavailable. Configuration comes only from settings.
    void stores.credentials.persist.rehydrate().then(
      () => stores.workspace.getState().hydrate(),
      () => stores.workspace.getState().hydrate(),
    );
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

export function useCredentialsStore<T>(selector: (state: CredentialsState) => T) {
  return useStore(useStores().credentials, selector);
}

export function useSessionStore<T>(mode: WorkspaceMode, selector: (state: SessionState) => T) {
  return useStore(useStores()[mode] as StoreApi<SessionState>, selector);
}

export function useLabSessionApi() { return useStores().lab; }
export function useVoiceSessionApi() { return useStores().live; }
