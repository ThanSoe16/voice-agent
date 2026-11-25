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
const { createCredentialsStore } = require("../app/stores/credentials-store.ts");
const { deepgramRequestHeaders } = require("../app/lib/deepgram-request.ts");
const { POST: token } = require("../app/api/deepgram/token/route.ts");
const { POST: speak } = require("../app/api/speak/route.ts");
const { POST: transcribe } = require("../app/api/transcribe/route.ts");

function memoryStorage() {
  const data = new Map();
  return { data, getItem: name => data.get(name) ?? null, setItem: (name, value) => data.set(name, value), removeItem: name => data.delete(name) };
}

test("Zustand persist saves, reloads, and removes a browser key independently of workspace data", async () => {
  const storage = memoryStorage();
  storage.data.set("vocal.sessions.v1", "existing-history");
  const first = createCredentialsStore(storage);
  await first.persist.rehydrate();
  first.getState().setApiKey("  browser-test-key  ");
  assert.deepEqual(JSON.parse(storage.data.get("vocal.deepgram.v1")), { state: { apiKey: "browser-test-key" }, version: 0 });
  const reloaded = createCredentialsStore(storage);
  assert.equal(reloaded.getState().apiKey, "");
  await reloaded.persist.rehydrate();
  assert.equal(reloaded.getState().apiKey, "browser-test-key");
  reloaded.getState().setApiKey("");
  const cleared = createCredentialsStore(storage);
  await cleared.persist.rehydrate();
  assert.equal(cleared.getState().apiKey, "");
  assert.equal(storage.data.get("vocal.sessions.v1"), "existing-history");
});

test("credential hydration ignores invalid values and cannot overwrite store actions", async () => {
  const storage = memoryStorage();
  storage.data.set("vocal.deepgram.v1", JSON.stringify({ state: { apiKey: 42, setApiKey: "invalid" }, version: 0 }));
  const store = createCredentialsStore(storage);
  await store.persist.rehydrate();
  assert.equal(store.getState().apiKey, "");
  assert.equal(typeof store.getState().setApiKey, "function");
  const separate = createCredentialsStore(memoryStorage());
  store.getState().setApiKey("only-first-store");
  assert.equal(separate.getState().apiKey, "");
});

test("failed persistence reports failure to the settings caller while retaining the key in memory", async () => {
  const store = createCredentialsStore({ getItem: () => null, setItem: () => { throw new Error("Storage unavailable"); }, removeItem: () => {} });
  await store.persist.rehydrate();
  assert.throws(() => store.getState().setApiKey("in-memory-key"), /Storage unavailable/);
  assert.equal(store.getState().apiKey, "in-memory-key");
});

test("each Deepgram API route uses the browser key only for its own request", async t => {
  const previous = process.env.DEEPGRAM_API_KEY;
  process.env.DEEPGRAM_API_KEY = "server-test-key";
  t.after(() => {
    if (previous === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previous;
  });
  const makeRequest = (path, key, body, json = false) => new Request(`http://localhost:3000/api/${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3000", ...deepgramRequestHeaders(key), ...(json ? { "Content-Type": "application/json" } : {}) },
    body,
  });
  const audio = () => {
    const form = new FormData();
    form.append("audio", new File(["sample-audio"], "sample.webm", { type: "audio/webm" }));
    return form;
  };
  for (const [path, route, body, json, providerResponse] of [
    ["deepgram/token", token, undefined, false, { access_token: "temporary-token" }],
    ["speak", speak, () => JSON.stringify({ text: "Hello" }), true, null],
    ["transcribe", transcribe, audio, false, { results: { channels: [{ alternatives: [{ transcript: "Hello" }] }] } }],
  ]) {
    await t.test(`${path} requires the settings key even when an environment key exists`, async t => {
      const auth = [];
      t.mock.method(globalThis, "fetch", async (_url, options) => {
        auth.push(options.headers.Authorization);
        return providerResponse ? Response.json(providerResponse) : new Response("sample-audio");
      });
      const response = await route(makeRequest(path, "browser-test-key", body?.(), json));
      assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /browser-test-key|server-test-key/);
      const missing = await route(makeRequest(path, "", body?.(), json));
      assert.equal(missing.status, 503);
      assert.match((await missing.json()).error, /Agent settings/);
      assert.deepEqual(auth, ["Token browser-test-key"]);
      assert.equal(process.env.DEEPGRAM_API_KEY, "server-test-key");
    });
  }
  await t.test("a browser key works without server configuration", async t => {
    delete process.env.DEEPGRAM_API_KEY;
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      assert.equal(options.headers.Authorization, "Token browser-test-key");
      return Response.json({ access_token: "temporary-token" });
    });
    assert.equal((await token(makeRequest("deepgram/token", "browser-test-key"))).status, 200);
  });
});

const speechRequest = body => new Request("http://localhost:3000/api/speak", {
  method: "POST", headers: { "Content-Type": "application/json", ...deepgramRequestHeaders("preview-test-key") },
  body: JSON.stringify(body),
});

test("voice samples use Aura v1 and Flux v2 with the exact selected expressivity", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response("audio-sample", { headers: { "Content-Type": "audio/mpeg" } });
  });
  for (const voice of ["aura-2-thalia-en", "aura-2-andromeda-en", "aura-2-helena-en", "aura-2-apollo-en", "flux-kit-en", "flux-alexis-en"]) {
    const flux = voice.startsWith("flux-");
    for (const expressivity of flux ? [-2, -1, 0, 1, 2] : [0]) {
      const response = await speak(speechRequest({ text: "Hear this voice", voice, expressivity }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(await response.text(), "audio-sample");
      const { url, options } = requests.at(-1);
      assert.equal(url.origin, "https://api.deepgram.com");
      assert.equal(url.pathname, flux ? "/v2/speak" : "/v1/speak");
      assert.equal(url.searchParams.get("model"), voice);
      assert.equal(url.searchParams.get("encoding"), "mp3");
      assert.equal(url.searchParams.get("expressivity"), flux ? String(expressivity) : null);
      assert.equal(options.headers.Authorization, "Token preview-test-key");
      assert.deepEqual(JSON.parse(options.body), { text: "Hear this voice" });
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
    }
  }
});

test("invalid speech preview controls never reach Deepgram", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Invalid request contacted Deepgram"));
  for (const body of [null, [], {}, { text: "" }, { text: "x".repeat(1001) }, { text: "Hello", voice: "unknown-voice" },
    ...[3, -3, 0.5, "1", null].map(expressivity => ({ text: "Hello", voice: "flux-kit-en", expressivity })),
    { text: "Hello", voice: "aura-2-thalia-en", expressivity: 1 }]) {
    assert.equal((await speak(speechRequest(body))).status, 400);
  }
  const malformed = speechRequest({});
  assert.equal((await speak(new Request(malformed, { body: "bad json" }))).status, 400);
});

test("speech preview failures report useful errors without leaking credentials or provider details", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch");
  for (const status of [401, 403, 429, 500]) {
    fetchMock.mock.mockImplementation(async () => new Response("private upstream details", { status }));
    const response = await speak(speechRequest({ text: "Hello", voice: "flux-kit-en" }));
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.doesNotMatch(body, /preview-test-key|private upstream details/);
    if (status === 401 || status === 403) assert.match(body, /API key permissions/);
  }
  fetchMock.mock.mockImplementation(async () => { throw new Error("private network details"); });
  const response = await speak(speechRequest({ text: "Hello" }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Could not reach Deepgram/);
});
