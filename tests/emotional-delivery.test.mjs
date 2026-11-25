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
const { DeliveryController, toneExpressivity, isExpressivity, isSpeechDelivery, deliverySettings, sessionExpressivity, parseToneMetadata, deliveryThinkSettings, speakSettings, buildVoiceAgentSettings } = require("../app/lib/emotional-delivery.ts");
const { defaultSettings, defaultEmotionalDelivery, responseTones } = require("../app/lib/types.ts");
const { createWorkspaceStore, isConversation } = require("../app/stores/workspace-store.ts");
const { sessionText } = require("../app/lib/conversations.ts");
const enabled = (extra = {}) => ({ ...defaultEmotionalDelivery, enabled: true, ...extra });
const settings = (extra = {}) => ({ ...defaultSettings, emotionalDelivery: enabled(extra) });
const call = (tone, id = tone) => ({ id, name: "set_response_tone", arguments: JSON.stringify({ tone }), client_side: true });
const message = { id: "u", role: "user", content: "A question", at: 1 };

test("the eight tone mappings are application policy with valid integer expressivity", () => {
  assert.deepEqual(toneExpressivity, { neutral: 0, happy: 1, excited: 2, empathetic: -1, calm: -2, concerned: -1, reassuring: -1, professional: 0 });
  assert.deepEqual(Object.keys(toneExpressivity), responseTones);
  for (const value of [-2, -1, 0, 1, 2]) assert.equal(isExpressivity(value), true);
  for (const value of [-3, 3, 1.5, NaN, Infinity, "1", null, undefined]) assert.equal(isExpressivity(value), false);
});

test("automatic session register comes from default tone; manual register is explicit; invalid values are neutral", () => {
  assert.equal(sessionExpressivity(enabled({ defaultTone: "excited" })), 2);
  assert.equal(sessionExpressivity(enabled({ defaultTone: "calm" })), -2);
  assert.equal(sessionExpressivity(enabled({ mode: "manual", defaultTone: "happy", defaultExpressivity: -1 })), -1);
  assert.equal(sessionExpressivity(enabled({ mode: "manual", defaultExpressivity: 42 })), 0);
  assert.equal(sessionExpressivity({ ...enabled({ defaultTone: "excited" }), enabled: false }), 0);
  assert.equal(deliverySettings({ ...settings(), emotionalDelivery: enabled({ defaultExpressivity: 0.5 }) }).enabled, false);
});

test("Flux uses supported raw PCM and a neutral Flux/Aura fallback chain without modifying the speaker per tone", () => {
  const config = buildVoiceAgentSettings(settings({ defaultTone: "excited" }), { sampleRate: 24000, resuming: false, history: [] });
  assert.deepEqual(config.audio.output, { encoding: "linear16", sample_rate: 24000, container: "none" });
  assert.deepEqual(config.agent.speak.map(item => item.provider), [
    { type: "deepgram", version: "v2", model: "flux-kit-en", expressivity: 2 },
    { type: "deepgram", version: "v2", model: "flux-kit-en", expressivity: 0 },
    { type: "deepgram", version: "v1", model: defaultSettings.voice },
  ]);
  assert.ok(!("language" in config.agent));
  assert.equal(speakSettings(settings()).length, 2);
});

test("disabled expressive delivery preserves the original Aura pipeline and user prompt", () => {
  assert.deepEqual(speakSettings(defaultSettings), { provider: { type: "deepgram", version: "v1", model: defaultSettings.voice } });
  assert.deepEqual(deliveryThinkSettings(defaultSettings), { prompt: defaultSettings.prompt });
});

test("the prompt distinguishes response tone from user emotion and keeps metadata out of speech", () => {
  const automatic = deliveryThinkSettings(settings());
  assert.ok(automatic.prompt.startsWith(defaultSettings.prompt));
  assert.match(automatic.prompt, /cannot reliably reveal/);
  assert.match(automatic.prompt, /Never put delivery metadata in spoken text/);
  assert.match(automatic.prompt, /Expressivity is fixed at 0/);
  assert.equal(automatic.functions[0].name, "set_response_tone");
  assert.equal(automatic.functions[0].defer_until_eot, true);
  assert.deepEqual(automatic.functions[0].parameters.properties.tone.enum, responseTones);
  assert.equal(deliveryThinkSettings(settings({ mode: "manual" })).functions, undefined);
});

test("outgoing tone functions use Settings definition fields, not FunctionCallRequest fields", () => {
  // Contract: https://developers.deepgram.com/reference/voice-agent/voice-agent
  // ThinkSettingsV1FunctionsItems has no client_side field. Without an endpoint,
  // Deepgram dispatches to the client and includes client_side in its request.
  for (const resuming of [false, true]) {
    const payload = JSON.parse(JSON.stringify(buildVoiceAgentSettings(settings(), { sampleRate: 24000, resuming, history: [] })));
    const [definition] = payload.agent.think.functions;
    assert.deepEqual(Object.keys(definition).sort(), ["defer_until_eot", "description", "name", "parameters"]);
    assert.equal("client_side" in definition, false);
    assert.equal("endpoint" in definition, false);
    assert.equal(definition.defer_until_eot, true);
    assert.deepEqual(definition.parameters.required, ["tone"]);
    assert.deepEqual(definition.parameters.properties.tone.enum, responseTones);
  }
});

test("automatic tone metadata updates immediately without UpdateSpeak or another TTS connection", () => {
  const sent = [], changes = [];
  const controller = new DeliveryController(enabled(), data => changes.push(data));
  controller.request([call("happy"), call("excited"), call("calm")], event => sent.push(event));
  assert.ok(sent.every(item => item.type === "FunctionCallResponse"));
  assert.deepEqual(changes.map(item => item.tone), ["happy", "excited", "calm"]);
  assert.ok(changes.every(item => item.expressivity === 0));
  assert.deepEqual(changes.map(item => item.suggestedExpressivity), [1, 2, -2]);
  assert.deepEqual(controller.response("Let's take this one step at a time."), { text: "Let's take this one step at a time.", delivery: controller.snapshot() });
});

test("missing, malformed, or unsupported LLM metadata defaults to neutral without accepting arbitrary synthesis parameters", () => {
  for (const value of [undefined, null, "bad-json", "{}", { tone: "angry" }, { tone: 42 }, []]) assert.equal(parseToneMetadata(value), "neutral");
  const controller = new DeliveryController(enabled(), () => {});
  const sent = [];
  controller.request(undefined, event => sent.push(event));
  assert.equal(controller.snapshot().source, "default");
  controller.request([{ ...call("happy"), arguments: "broken" }], event => sent.push(event));
  assert.equal(controller.snapshot().tone, "neutral");
  assert.equal(controller.snapshot().source, "default");
  controller.request([{ ...call("happy", "real"), arguments: JSON.stringify({ tone: "happy", expressivity: 100, model: "aura-other" }) }], event => sent.push(event));
  assert.equal(controller.snapshot().expressivity, 0);
  assert.equal(controller.snapshot().suggestedExpressivity, 1);
});

test("duplicate and server-side tool calls are ignored; unknown client tools receive errors", () => {
  const sent = [];
  const controller = new DeliveryController(enabled(), () => {});
  controller.request([null, call("happy"), call("happy"), { ...call("calm"), client_side: false }, { ...call("calm", "unknown"), name: "other_tool" }], item => sent.push(item));
  assert.equal(sent.length, 2);
  assert.ok(JSON.parse(sent[1].content).error);
  assert.equal(controller.snapshot().tone, "happy");
});

test("cancelled tone selections roll back without replaying tool responses or affecting the session register", () => {
  const sent = [];
  const controller = new DeliveryController(enabled(), () => {});
  controller.beginTurn();
  controller.request([call("happy"), call("excited")], event => sent.push(event));
  controller.cancel([{ id: "happy" }, { id: "excited" }]);
  assert.equal(controller.snapshot().tone, "neutral");
  assert.equal(controller.snapshot().expressivity, 0);
  assert.equal(sent.length, 2);
});

test("provider failure records neutral fallback, retains response style, and retries the primary register on the next turn", () => {
  const controller = new DeliveryController(enabled({ defaultTone: "excited" }), () => {});
  controller.fallback();
  assert.equal(controller.snapshot().tone, "excited");
  assert.equal(controller.snapshot().expressivity, 0);
  assert.equal(controller.snapshot().neutralFallback, true);
  controller.beginTurn();
  assert.equal(controller.snapshot().expressivity, 2);
  assert.equal(controller.snapshot().neutralFallback, false);
  const forced = buildVoiceAgentSettings(settings({ defaultTone: "excited" }), { sampleRate: 24000, resuming: false, history: [], forceAura: true });
  assert.equal(forced.agent.speak.provider.version, "v1");
  assert.equal(forced.agent.speak.provider.expressivity, undefined);
  assert.match(forced.agent.think.prompt, /Expressivity is fixed at 0/);
});

test("reconnection retains recent conversation text and tone without repeating the greeting or retaining old tool calls", () => {
  const history = Array.from({ length: 45 }, (_, index) => ({ ...message, id: String(index), content: `Turn ${index}`, role: index % 2 ? "assistant" : "user" }));
  const resumed = buildVoiceAgentSettings(settings(), { sampleRate: 24000, resuming: true, history, lastTone: "reassuring" });
  assert.equal(resumed.agent.greeting, undefined);
  assert.equal(resumed.agent.context.messages.length, 40);
  assert.deepEqual(resumed.agent.context.messages[0], { type: "History", role: "assistant", content: "Turn 5" });
  assert.match(resumed.agent.think.prompt, /response tone reassuring/);
});

test("legacy preferences and old speaker-switching transcripts survive, while expressive metadata is validated and persisted", () => {
  const legacy = { name: "Existing agent", voice: "aura-2-helena-en", prompt: "Existing prompt", greeting: "Welcome back", emotionVoices: { enabled: true } };
  const data = new Map([["vocal.settings.v1", JSON.stringify(legacy)]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const store = createWorkspaceStore(); store.getState().hydrate(storage);
  assert.equal(store.getState().settings.name, legacy.name);
  assert.equal(deliverySettings(store.getState().settings).enabled, false);
  store.getState().setSettings(settings({ defaultTone: "reassuring" }));
  const delivery = new DeliveryController(enabled(), () => {}).snapshot();
  const session = { id: "session", title: "Delivery test", startedAt: 1, duration: 1, voice: "flux-kit-en", messages: [{ ...message, role: "assistant", delivery }] };
  assert.equal(isConversation(session), true);
  assert.equal(isSpeechDelivery({ ...delivery, expressivity: 100 }), false);
  assert.equal(isConversation({ ...session, messages: [{ ...message, delivery: { tone: "invalid" } }] }), false);
  store.getState().saveSession(session);
  const reloaded = createWorkspaceStore(); reloaded.getState().hydrate(storage);
  assert.equal(reloaded.getState().settings.emotionalDelivery.defaultTone, "reassuring");
  assert.deepEqual(reloaded.getState().sessions[0].messages[0].delivery, delivery);
});

test("invalid saved expressive controls fall back to disabled neutral settings while preserving the agent's other preferences", () => {
  const invalid = { ...settings(), name: "Keep my name", emotionalDelivery: enabled({ defaultExpressivity: 0.5 }) };
  const store = createWorkspaceStore();
  store.getState().hydrate({ getItem: name => name === "vocal.settings.v1" ? JSON.stringify(invalid) : null, setItem: () => {} });
  assert.equal(store.getState().settings.name, "Keep my name");
  assert.deepEqual(store.getState().settings.emotionalDelivery, defaultEmotionalDelivery);
});

test("expected LLM tone fixtures cover happy, sad, frustrated, confused, and neutral conversations without claiming emotion inference", () => {
  const fixtures = [["I got the job!", "happy"], ["I lost someone close to me.", "empathetic"], ["This keeps failing. I'm fed up.", "reassuring"], ["I don't understand the steps.", "calm"], ["What time is the appointment?", "neutral"]];
  const controller = new DeliveryController(enabled(), () => {});
  for (const [text, expectedTone] of fixtures) {
    controller.beginTurn();
    controller.request([call(expectedTone, text)], () => {});
    assert.equal(controller.snapshot().tone, expectedTone);
    assert.equal(controller.snapshot().expressivity, 0);
  }
  controller.dispose();
  controller.request([call("excited", "after-stop")], () => assert.fail("Response after disposal"));
});

test("latency exports distinguish Aura baseline and expressive sessions, with validated samples and separate delivery metadata", () => {
  const delivery = new DeliveryController(enabled(), () => {}).snapshot();
  const session = { id: "benchmark", title: "Matched prompt", startedAt: 1, duration: 2, voice: "flux-kit-en", mode: "live", messages: [{ ...message, role: "assistant", content: "A natural spoken response.", delivery }], metrics: { deliveryEnabled: true, firstAudioLatencyMs: [100, 200, 300], reconnects: 1 } };
  assert.equal(isConversation(session), true);
  const exported = sessionText(session);
  assert.match(exported, /Expressive TTS/);
  assert.match(exported, /200 ms mean \(3 samples\)/);
  assert.match(exported, /Agent \[neutral; session expressivity 0\]: A natural spoken response\./);
  assert.equal(session.messages[0].content, "A natural spoken response.");
  assert.match(sessionText({ ...session, metrics: { ...session.metrics, deliveryEnabled: false } }), /Aura baseline/);
  assert.equal(isConversation({ ...session, metrics: { ...session.metrics, firstAudioLatencyMs: [NaN] } }), false);
  assert.equal(isConversation({ ...session, metrics: { ...session.metrics, reconnects: -1 } }), false);
});
