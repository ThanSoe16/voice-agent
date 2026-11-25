import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

export type CredentialsState = {
  apiKey: string;
  setApiKey: (apiKey: string) => void;
};

export function createCredentialsStore(storage?: StateStorage) {
  return createStore<CredentialsState>()(persist(
    set => ({ apiKey: "", setApiKey: apiKey => set({ apiKey: apiKey.trim() }) }),
    {
      name: "vocal.deepgram.v1",
      // Defer browser storage access and hydration until after the initial render.
      storage: createJSONStorage(() => storage ?? {
        getItem: name => localStorage.getItem(name),
        setItem: (name, value) => localStorage.setItem(name, value),
        removeItem: name => localStorage.removeItem(name),
      }),
      skipHydration: true,
      partialize: state => ({ apiKey: state.apiKey }),
      merge: (persisted, current) => {
        const saved = persisted as { apiKey?: unknown } | null;
        return { ...current, apiKey: typeof saved?.apiKey === "string" ? saved.apiKey.trim() : "" };
      },
    },
  ));
}
