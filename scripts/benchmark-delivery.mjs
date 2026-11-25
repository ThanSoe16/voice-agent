import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const { DeliveryController } = require("../app/lib/emotional-delivery.ts");
const { defaultEmotionalDelivery, responseTones } = require("../app/lib/types.ts");
const count = 5000;
const content = "Let's take this one step at a time.";
const controller = new DeliveryController({ ...defaultEmotionalDelivery, enabled: true }, () => {});
let synthesisUpdates = 0;
let replies = 0;
const receive = message => { if (message.type === "UpdateSpeak") synthesisUpdates++; if (message.type === "FunctionCallResponse") replies++; };
function measure(run) {
  const samples = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); run(i); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  return { p50_ms: Number(samples[Math.floor(count * .5)].toFixed(6)), p95_ms: Number(samples[Math.floor(count * .95)].toFixed(6)) };
}
const baseline = measure(() => JSON.stringify({ text: content }));
const expressive = measure(index => {
  controller.beginTurn();
  controller.request([{ id: String(index), name: "set_response_tone", client_side: true, arguments: JSON.stringify({ tone: responseTones[index % responseTones.length] }) }], receive);
  JSON.stringify(controller.response(content));
});
controller.dispose();
process.stdout.write(`${JSON.stringify({
  scope: "Local metadata handling only; excludes network, LLM generation, synthesis, and audio playback latency.",
  iterations: count, baseline, expressive, synthesis_updates: synthesisUpdates, metadata_tool_responses: replies,
  live_before_after_latency: "Not measured: run comparable Aura and Flux conversations with your settings key, then export their first-audio metrics.",
}, null, 2)}\n`);
