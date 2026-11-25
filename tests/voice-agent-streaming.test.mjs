import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const { VoiceAgentTransport } = require("../app/lib/voice-agent-transport.ts");
const { PcmPlayback } = require("../app/lib/pcm-playback.ts");
const { buildVoiceAgentSettings } = require("../app/lib/emotional-delivery.ts");
const { defaultSettings, defaultEmotionalDelivery } = require("../app/lib/types.ts");
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

class FakeSocket {
  readyState = 1;
  bufferedAmount = 0;
  binaryType = "blob";
  onmessage = null;
  onerror = null;
  onclose = null;
  sent = [];
  send(value) { this.sent.push(typeof value === "string" ? JSON.parse(value) : value); }
  close() { this.readyState = 3; }
  emit(type, data = {}) { this.onmessage?.({ data: JSON.stringify({ type, ...data }) }); }
  audio(bytes = new Int16Array([123, -123]).buffer) { this.onmessage?.({ data: bytes }); }
}
function transportHarness(t, overrides = {}) {
  const sockets = [], tokens = [], settingsCalls = [], ready = [], messages = [], audio = [], retries = [], errors = [], ended = [];
  const history = [{ id: "user", role: "user", content: "Keep this question", at: 1 }];
  let forceAura = false;
  const transport = new VoiceAgentTransport({
    token: async () => { const token = `temporary-${tokens.length + 1}`; tokens.push(token); return token; },
    socketFactory: (url, protocols) => { const socket = new FakeSocket(); sockets.push(socket); socket.url = url; socket.protocols = protocols; return socket; },
    settings: resuming => {
      settingsCalls.push(resuming);
      return buildVoiceAgentSettings({ ...defaultSettings, emotionalDelivery: { ...defaultEmotionalDelivery, enabled: true } }, { sampleRate: 24000, resuming, history, forceAura });
    },
    onReady: resuming => ready.push(resuming), onMessage: message => messages.push(message), onAudio: bytes => audio.push(bytes),
    onReconnecting: attempt => retries.push(attempt), onFatal: message => errors.push(message), onEnd: () => ended.push(true),
    ...overrides,
  });
  t.after(() => transport.close());
  return { transport, sockets, tokens, settingsCalls, ready, messages, audio, retries, errors, ended, useAura: () => { forceAura = true; } };
}

test("streaming waits for Welcome and SettingsApplied, then sends and receives audio", async t => {
  const h = transportHarness(t); h.transport.connect(); await settle();
  const socket = h.sockets[0];
  assert.equal(socket.url, "wss://agent.deepgram.com/v1/agent/converse");
  assert.deepEqual(socket.protocols, ["bearer", "temporary-1"]);
  socket.audio(); socket.emit("FunctionCallRequest", { functions: [] });
  assert.equal(h.audio.length, 0); assert.equal(h.messages.length, 0);
  assert.equal(h.transport.sendAudio(new ArrayBuffer(8)), false);
  socket.emit("Welcome");
  assert.equal(socket.sent[0].type, "Settings");
  assert.equal(socket.sent[0].agent.speak[0].provider.expressivity, 0);
  socket.emit("SettingsApplied"); socket.audio();
  assert.deepEqual(h.ready, [false]); assert.equal(h.audio.length, 1);
  assert.equal(h.transport.sendAudio(new ArrayBuffer(8)), true);
  socket.bufferedAmount = 256000;
  assert.equal(h.transport.sendAudio(new ArrayBuffer(8)), false);
});

test("temporary credentials refresh on reconnect, recent context survives, and old socket events cannot affect the new session", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = transportHarness(t); h.transport.connect(); await settle();
  const first = h.sockets[0]; first.emit("Welcome"); first.emit("SettingsApplied");
  const stale = first.onmessage;
  first.onclose({ code: 1006 });
  assert.deepEqual(h.retries, [1]);
  assert.equal(first.readyState, 3);
  t.mock.timers.tick(500); await settle();
  const second = h.sockets[1]; second.emit("Welcome"); second.emit("SettingsApplied");
  assert.deepEqual(h.tokens, ["temporary-1", "temporary-2"]);
  assert.deepEqual(h.ready, [false, true]);
  assert.deepEqual(second.sent[0].agent.context.messages, [{ type: "History", role: "user", content: "Keep this question" }]);
  assert.equal(second.sent[0].agent.greeting, undefined);
  stale({ data: new ArrayBuffer(8) });
  stale({ data: JSON.stringify({ type: "ConversationText", role: "assistant", content: "Stale reply" }) });
  assert.equal(h.audio.length, 0); assert.equal(h.messages.length, 0);
  second.audio(); assert.equal(h.audio.length, 1);
});

test("a rejected Flux configuration can reconnect once with plain Aura settings", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = transportHarness(t); h.transport.connect(); await settle();
  h.sockets[0].emit("Welcome"); h.sockets[0].emit("Error", { code: "INVALID_SETTINGS" });
  assert.equal(h.messages[0].code, "INVALID_SETTINGS");
  h.useAura(); h.transport.restart();
  t.mock.timers.tick(500); await settle();
  h.sockets[1].emit("Welcome");
  assert.deepEqual(h.sockets[1].sent[0].agent.speak.provider, { type: "deepgram", version: "v1", model: defaultSettings.voice });
});

test("normal server close ends cleanly; manual stop cannot reconnect or accept late frames", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = transportHarness(t); h.transport.connect(); await settle();
  const stale = h.sockets[0].onmessage;
  h.sockets[0].onclose({ code: 1000 });
  assert.equal(h.ended.length, 1);
  h.transport.close(); h.transport.connect(); t.mock.timers.tick(30000); await settle();
  stale({ data: new ArrayBuffer(8) });
  assert.equal(h.sockets.length, 1); assert.equal(h.audio.length, 0); assert.equal(h.errors.length, 0);
});

test("recoverable connection failures stop after two retries instead of looping forever", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = transportHarness(t); h.transport.connect(); await settle();
  h.sockets[0].onerror({}); t.mock.timers.tick(500); await settle();
  h.sockets[1].onerror({}); t.mock.timers.tick(1000); await settle();
  h.sockets[2].onerror({}); t.mock.timers.tick(10000); await settle();
  assert.equal(h.sockets.length, 3);
  assert.deepEqual(h.retries, [1, 2]);
  assert.match(h.errors[0], /transcript has been saved/);
});

test("authorization failures do not reconnect, and a stopped in-flight token request cannot create a socket", async t => {
  const failed = transportHarness(t, { token: async () => { throw new Error("Invalid settings key"); } });
  failed.transport.connect(); await settle();
  assert.equal(failed.sockets.length, 0); assert.deepEqual(failed.errors, ["Invalid settings key"]);
  let resolve;
  const stopped = transportHarness(t, { token: () => new Promise(done => { resolve = done; }) });
  stopped.transport.connect(); stopped.transport.close(); resolve("late-token"); await settle();
  assert.equal(stopped.sockets.length, 0);
});

test("handshake timeout recovers, malformed frames are ignored, and duplicate connect calls do not mint extra tokens", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = transportHarness(t); h.transport.connect(); h.transport.connect(); await settle();
  assert.equal(h.tokens.length, 1);
  for (const data of ["null", "not JSON", "{}", "[]"]) h.sockets[0].onmessage({ data });
  assert.equal(h.messages.length, 0);
  t.mock.timers.tick(20000); assert.deepEqual(h.retries, [1]);
});

test("keep-alive messages are sent only when the audio stream is idle", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const h = transportHarness(t); h.transport.connect(); await settle();
  const socket = h.sockets[0]; socket.emit("Welcome"); socket.emit("SettingsApplied");
  t.mock.timers.tick(7000); h.transport.sendAudio(new ArrayBuffer(8)); t.mock.timers.tick(1000);
  assert.equal(socket.sent.filter(item => item.type === "KeepAlive").length, 0);
  t.mock.timers.tick(8000);
  assert.equal(socket.sent.filter(item => item.type === "KeepAlive").length, 1);
});

function audioContext() {
  const sources = [], buffers = [];
  const context = {
    state: "running", currentTime: 1, destination: {},
    createBuffer: (_channels, length, rate) => {
      const samples = new Float32Array(length);
      const buffer = { duration: length / rate, getChannelData: () => samples, samples };
      buffers.push(buffer); return buffer;
    },
    createBufferSource: () => {
      const source = { onended: null, stopped: false, connect: () => {}, start: when => { source.when = when; }, stop: () => { source.stopped = true; source.onended?.(); } };
      sources.push(source); return source;
    },
  };
  return { context, sources, buffers };
}

test("PCM playback decodes signed samples and schedules contiguous chunks without overlap", () => {
  const { context, sources, buffers } = audioContext();
  let idle = 0;
  const playback = new PcmPlayback(context, () => idle++, () => {});
  const bytes = new Int16Array([32767, -32768, 0]).buffer;
  assert.equal(playback.queue(bytes), true); assert.equal(playback.queue(bytes), true);
  assert.equal(buffers[0].samples[1], -1);
  assert.equal(buffers[0].samples[2], 0);
  assert.equal(sources[1].when, sources[0].when + buffers[0].duration);
  sources[0].onended(); assert.equal(idle, 0);
  sources[1].onended(); assert.equal(idle, 1); assert.equal(playback.pending, 0);
});

test("barge-in stops all scheduled audio and rejects stale chunks and callbacks until a new turn", () => {
  const { context, sources } = audioContext(); let idle = 0;
  const playback = new PcmPlayback(context, () => idle++, () => {});
  const bytes = new Int16Array([100, -100]).buffer;
  playback.queue(bytes); const stale = sources[0].onended;
  playback.interrupt();
  assert.equal(sources[0].stopped, true); assert.equal(playback.pending, 0);
  assert.equal(playback.queue(bytes), false); stale(); assert.equal(idle, 0);
  playback.beginTurn(); assert.equal(playback.queue(bytes), true);
  assert.equal(playback.pending, 1); assert.equal(sources[1].when, context.currentTime + 0.015);
});

test("empty, misaligned, and post-disposal audio cannot reach the output queue", () => {
  const { context, sources } = audioContext();
  const playback = new PcmPlayback(context, () => {}, () => {});
  assert.equal(playback.queue(new ArrayBuffer(0)), false);
  assert.equal(playback.queue(new ArrayBuffer(3)), false);
  context.state = "closed";
  assert.equal(playback.queue(new ArrayBuffer(4)), false);
  assert.equal(sources.length, 0);
});

test("greeting and repeated spoken replies play even when AgentThinking is absent", async t => {
  const { context, sources } = audioContext();
  let playing = 0;
  const playback = new PcmPlayback(context, () => {}, () => playing++);
  const accepted = [];
  const h = transportHarness(t, {
    onReady: () => playback.beginTurn(),
    onMessage: event => playback.handleEvent(event),
    onAudio: bytes => accepted.push(playback.queue(bytes)),
  });
  h.transport.connect(); await settle();
  const socket = h.sockets[0]; socket.emit("Welcome"); socket.emit("SettingsApplied");
  socket.emit("ConversationText", { role: "assistant", content: "Hello!" });
  socket.audio();
  assert.equal(playing, 1);
  for (let turn = 0; turn < 3; turn++) {
    socket.emit("UserStartedSpeaking");
    assert.equal(playback.pending, 0);
    socket.audio(); // Already in flight from the interrupted response.
    assert.equal(accepted.at(-1), false);
    socket.emit("ConversationText", { role: "user", content: `Question ${turn}` });
    socket.emit("ConversationText", { role: "assistant", content: `Reply ${turn}` });
    socket.audio();
    assert.equal(accepted.at(-1), true);
    const firstChunk = sources.at(-1);
    socket.emit("ConversationText", { role: "assistant", content: "Another sentence." });
    socket.audio();
    assert.equal(playback.pending, 2);
    assert.equal(firstChunk.stopped, false);
    assert.equal(sources.at(-1).when, firstChunk.when + firstChunk.buffer.duration);
  }
  assert.equal(playing, 7);
});

test("reasoning and unrelated events cannot unlock interrupted audio before a spoken reply", () => {
  const { context } = audioContext();
  const playback = new PcmPlayback(context, () => {}, () => {});
  const bytes = new Int16Array([100, -100]).buffer;
  playback.handleEvent({ type: "UserStartedSpeaking" });
  for (const event of [
    { type: "AgentThinking" }, { type: "AgentAudioDone" },
    { type: "FunctionCallRequest" },
    { type: "ConversationText", role: "user", content: "Hi" },
    { type: "ConversationText", role: "assistant", content: "" },
    { type: "ConversationText", role: "assistant", content: null },
  ]) {
    playback.handleEvent(event);
    assert.equal(playback.queue(bytes), false);
  }
  playback.handleEvent({ type: "ConversationText", role: "assistant", content: "Hi there" });
  assert.equal(playback.queue(bytes), true);
});
