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
const { POST } = require("../app/api/deepgram/token/route.ts");
const request = (origin = "http://localhost:3000", apiKey = "settings-test-key") => new Request("http://localhost:3000/api/deepgram/token", {
  method: "POST", headers: { origin, ...(apiKey ? { "X-Deepgram-Api-Key": apiKey } : {}) },
});

test("Deepgram session token route", async t => {
  await t.test("rejects cross-origin requests before contacting Deepgram", async t => {
    const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
    const response = await POST(request("https://another-app.example"));
    assert.equal(response.status, 403);
    assert.equal(fetch.mock.callCount(), 0);
  });

  await t.test("reports missing configuration without contacting Deepgram", async t => {
    const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
    assert.equal((await POST(request("http://localhost:3000", ""))).status, 503);
    assert.equal(fetch.mock.callCount(), 0);
  });

  await t.test("keeps the API key private and issues only the temporary token", async t => {
    t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, "https://api.deepgram.com/v1/auth/grant");
      assert.equal(options.headers.Authorization, "Token settings-test-key");
      assert.equal(options.cache, "no-store");
      return Response.json({ access_token: "temporary-token", expires_in: 60, private: "hidden" });
    });
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { token: "temporary-token" });
  });

  for (const [status, expected] of [[401, /valid key/], [403, /Member or higher permissions/], [429, /rate limiting/], [503, /temporarily unavailable/], [400, /project configuration/]]) {
    await t.test(`explains upstream ${status} without exposing the provider response`, async t => {
      t.mock.method(globalThis, "fetch", async () => Response.json({ err_msg: "private-provider-detail settings-test-key" }, { status }));
      const response = await POST(request());
      assert.equal(response.status, status === 429 ? 429 : 502);
      const body = await response.json();
      assert.match(body.error, expected);
      assert.doesNotMatch(JSON.stringify(body), /private-provider-detail|settings-test-key/);
      if (status !== 403) assert.doesNotMatch(body.error, /Member/);
    });
  }

  await t.test("rejects missing or empty tokens from successful provider responses", async t => {
    for (const payload of [null, {}, { access_token: "" }]) {
      t.mock.method(globalThis, "fetch", async () => Response.json(payload));
      const response = await POST(request());
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /invalid session token/);
      t.mock.restoreAll();
    }
  });

  await t.test("reports network failures separately from permissions", async t => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("private-network-detail"); });
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Could not reach Deepgram/);
  });
});
