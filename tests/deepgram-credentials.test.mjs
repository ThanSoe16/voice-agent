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
