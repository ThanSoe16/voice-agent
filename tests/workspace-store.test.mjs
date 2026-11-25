import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Run the actual TypeScript stores with Node's test runner; no browser or test
// framework dependency is needed for persistence and request-isolation checks.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const { createWorkspaceStore } = require("../app/stores/workspace-store.ts");
const { createSessionStore, selectSessionView } = require("../app/stores/session-store.ts");
const { defaultSettings } = require("../app/lib/types.ts");
const { shallow } = require("zustand/shallow");

const historyKey = "vocal.sessions.v1";
const settingsKey = "vocal.settings.v1";
function session(id = "existing") {
  return { id, title: "An existing test", startedAt: 1234, duration: 15, voice: defaultSettings.voice, mode: "lab", messages: [{ id: "message", role: "user", content: "Keep this transcript", at: 1234 }] };
}
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    data,
    writes,
  };
}

test("loads old history and preferences without overwriting them during hydration", () => {
  const existing = session();
  const settings = { ...defaultSettings, name: "My existing agent", voice: "aura-2-apollo-en" };
  const storage = memoryStorage({ [historyKey]: JSON.stringify([existing]), [settingsKey]: JSON.stringify(settings) });
  const store = createWorkspaceStore();
  assert.equal(store.getState().hydrated, false);
  assert.deepEqual(store.getState().sessions, []);
  store.getState().hydrate(storage);
  store.getState().hydrate(storage); // Strict Mode's second effect is harmless.
  assert.deepEqual(store.getState().sessions, [existing]);
  assert.deepEqual(store.getState().settings, settings);
  assert.deepEqual(storage.writes, []);
  store.getState().setSettings({ ...settings, name: "Renamed agent" });
  assert.deepEqual(storage.writes, [settingsKey]);
  assert.deepEqual(JSON.parse(storage.data.get(historyKey)), [existing]);
});

test("transient workspace changes never write history or settings", () => {
  const storage = memoryStorage();
  const store = createWorkspaceStore();
  store.getState().hydrate(storage);
  store.getState().setView("history");
  store.getState().setDialog("settings");
  store.getState().notify("Copied");
  store.getState().openSession(session());
  store.getState().newSession();
  assert.deepEqual(storage.writes, []);
});

test("session updates and deletion remain durable and clear a deleted preview", () => {
  const storage = memoryStorage();
  const store = createWorkspaceStore();
  store.getState().hydrate(storage);
  store.getState().saveSession(session());
  store.getState().saveSession({ ...session(), duration: 27 });
  assert.equal(JSON.parse(storage.data.get(historyKey)).length, 1);
  assert.equal(JSON.parse(storage.data.get(historyKey))[0].duration, 27);
  store.getState().openSession(store.getState().sessions[0]);
  store.getState().requestDelete(store.getState().sessions[0]);
  store.getState().deleteSession("existing");
  assert.deepEqual(JSON.parse(storage.data.get(historyKey)), []);
  assert.equal(store.getState().selected, null);
  assert.equal(store.getState().pendingDelete, null);
});

test("corrupt preferences do not discard valid history, and malformed records are filtered", () => {
  const storage = memoryStorage({ [historyKey]: JSON.stringify([session(), null, { messages: [null] }]), [settingsKey]: "broken-json" });
  const store = createWorkspaceStore();
  store.getState().hydrate(storage);
  assert.deepEqual(store.getState().sessions, [session()]);
  assert.deepEqual(store.getState().settings, defaultSettings);
  assert.ok(store.getState().storageError);
  assert.deepEqual(storage.writes, []);
});

test("storage failures report a recoverable error while retaining in-memory transcripts", () => {
  const store = createWorkspaceStore();
  store.getState().hydrate({ getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } });
  assert.doesNotThrow(() => store.getState().saveSession(session()));
  assert.equal(store.getState().sessions.length, 1);
  assert.match(store.getState().storageError, /could not save/);
});

test("separate workspace instances do not share settings or conversations", () => {
  const first = createWorkspaceStore();
  const second = createWorkspaceStore();
  first.getState().saveSession(session());
  first.getState().setSettings({ ...defaultSettings, name: "First workspace" });
  assert.deepEqual(second.getState().sessions, []);
  assert.deepEqual(second.getState().settings, defaultSettings);
});

test("microphone levels do not invalidate the page's selected session state", () => {
  const store = createSessionStore();
  const before = selectSessionView(store.getState());
  store.setState({ level: 0.75 });
  assert.equal(shallow(before, selectSessionView(store.getState())), true);
  store.setState({ status: "recording" });
  assert.equal(shallow(before, selectSessionView(store.getState())), false);
  assert.equal(createSessionStore().getState().level, 0);
});
