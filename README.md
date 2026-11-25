# Vocal

A Next.js voice testing workspace powered by Deepgram.

## Run locally

1. Install dependencies with `pnpm install`.
2. Run `pnpm dev` and open the printed local URL.
3. Open **Agent settings**, paste your Deepgram API key, and click **Save API key**.

A key saved in Agent settings is persisted by Zustand `persist` in browser local storage under `vocal.deepgram.v1`. It is the only API key used for Live Agent and Speech Lab. Environment API keys are ignored. Removing the saved key disables voice features until a key is saved again. Local storage is not encrypted and is accessible to scripts on this origin. Browser keys are sent in a header to this app’s API routes and forwarded only to Deepgram, without changing server configuration. The Live Agent WebSocket uses a short-lived token rather than the API key. Live Agent requires Member or higher key permissions, plus Voice Agent access.

If Live Agent reports **403 / insufficient permissions**, open Deepgram Console → API Keys → Create Key → Advanced and select **Member** (or higher). Save the replacement key in Agent settings. A key that works for transcription can still lack permission to mint Live Agent tokens. See [Deepgram's token authentication guide](https://developers.deepgram.com/guides/fundamentals/token-based-authentication).

## Workspace

- **Speech lab:** record microphone audio, stop to transcribe with Nova-3, and generate MP3 speech with one of four Aura-2 voices. You can also enter text directly.
- **Live agent:** a two-way Voice Agent API session with streamed microphone audio, spoken replies, interruptions, text input, and transcript updates.
- **Agent settings:** change the voice, agent name, greeting, and live agent instructions. Settings are saved in the browser. Use **Test voice** below the main voice choices or inside Expressive TTS to hear the selected voice. Flux samples use the selected session expressivity. Samples use your saved settings key, play one at a time, and stop when settings close or a voice/delivery control changes; they do not start a microphone session or add history.
- **Expressive TTS:** enable this in Agent settings to use one Flux speaker with context-sensitive spoken responses. Choose automatic tone or a manual register, a default tone, and a session expressivity value. Your main Aura voice remains the fallback. Old speaker-switching settings are ignored; existing transcripts remain readable.
- **Session history:** search, revisit, copy, export, and delete transcripts. Up to 100 sessions are stored locally in this browser. Audio recordings are not persisted.

Speech lab transcribes after recording stops. Live Agent mode streams audio continuously while connected. Microphone use requires localhost or HTTPS and browser permission.

## State and forms

Zustand stores are created inside `WorkspaceProvider`, so each rendered workspace has its own state. `app/stores/workspace-store.ts` owns navigation, dialogs, settings, and saved sessions. It keeps the original browser storage keys, preserving existing history and preferences. `credentials-store.ts` uses Zustand persist with deferred client hydration to store only the Deepgram API key, separately from conversations and agent settings. `session-store.ts` holds transient audio and connection state; the visualizer subscribes to microphone levels separately from the page.

React Hook Form owns the agent settings, speech composer, live message composer, and history search inputs. Audio streams, WebSockets, and playback nodes stay in refs inside the audio hooks. They are never persisted.

## API routes

| Route | Purpose |
| --- | --- |
| `POST /api/transcribe` | Send an audio file as multipart `audio` and receive a transcript. |
| `POST /api/speak` | Send JSON with `text` (up to 1,000 characters) and an optional supported `voice`; receive MP3 audio. |
| `POST /api/deepgram/token` | Mint a short-lived token for a browser Voice Agent connection. |

The default live agent uses Deepgram Nova-3, a Deepgram-hosted `gpt-4o-mini` thinking model, and Aura-2 speech. No separate model-provider key is needed.

This is a local development workspace. Add authentication and per-user usage controls before exposing the API routes on a shared or public deployment. Local history is browser-specific and is cleared if site storage is deleted.

## Checks

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm benchmark:delivery
```

This Next.js version enables Cache Components and uses Node.js by default. API route files must not export a `runtime` segment setting. The existing Geist font setup downloads font files during a build, so the first build needs network access.


## Expressive TTS implementation report

### Architecture analysis and implementation plan

The original live pipeline was browser microphone → PCM AudioWorklet → one raw Voice Agent WebSocket → Deepgram Nova-3 → managed OpenAI `gpt-4o-mini` → Aura-2 → browser Web Audio output. The project has no Deepgram SDK dependency. It connects directly to `wss://agent.deepgram.com/v1/agent/converse`; the same-origin token route calls `https://api.deepgram.com/v1/auth/grant`. Input uses the AudioContext sample rate and `linear16`; output uses mono 24 kHz `linear16` without a container. Turn detection and VAD are managed by Deepgram. The client responds to `UserStartedSpeaking` to stop playback. Speech Lab separately uses `/v1/listen` and `/v1/speak` REST requests.

The previous emotion feature changed the speaker through `UpdateSpeak`. This implementation replaces it with delivery configuration and separate response-tone metadata. The STT, managed LLM, microphone worklet, streaming endpoint, and settings-only authentication remain in place.

The incremental plan was to validate provider capabilities, define typed delivery settings and tone policy, configure Flux with neutral/Aura fallback, integrate tone selection into the managed LLM response flow, isolate playback/reconnection handling for testing, and add comparable first-audio instrumentation. No new package dependencies were added.

Deepgram documents expressivity as a session-level Flux setting with integer values from -2 to 2; 0 is the production baseline and nonzero values are experimental. It controls a calm-to-animated register, not named emotions. See [Voice Agent TTS controls](https://developers.deepgram.com/docs/voice-agent-tts-controls) and [Expressivity](https://developers.deepgram.com/docs/tts-expressivity).

### Behavior and configuration

Expressive TTS is disabled by default, preserving the original Aura path. When enabled, a single selected Flux voice (Kit or Alexis) is used throughout the conversation. Settings are stored alongside existing agent preferences.

| Response tone | Application mapping |
| --- | ---: |
| Neutral | 0 |
| Happy | 1 |
| Excited | 2 |
| Empathetic | -1 |
| Calm | -2 |
| Concerned | -1 |
| Reassuring | -1 |
| Professional | 0 |

In **automatic tone** mode, the default tone supplies the session's initial expressivity. During the conversation, the existing LLM selects response tones through a `set_response_tone` tool only when the style changes. This is not a separate sentiment-classifier request. The application returns the metadata immediately, without another TTS handshake. Tone labels describe the intended reply style, not a reliable measurement of the user's feelings.

In **manual register** mode, the user selects the session expressivity directly and no tone-selection tool is registered. The default response tone still guides wording. In both modes, numeric expressivity stays fixed for the session; a new session is needed to change it. `suggestedExpressivity` records the application's tone mapping while `expressivity` records the session register or neutral fallback. These values are deliberately separate so a happy tone is not falsely reported as a live numeric synthesis change.

The system prompt keeps the user's own instructions and adds rules for empathetic responses to concerns, measured energy for positive news, calm explanations, varied vocabulary, and ordinary punctuation. It prohibits spoken metadata, emotion labels, stage directions, markdown, SSML, and unsupported audio tags. The managed LLM retains conversation context. Tool results and `SpokenResponse.delivery` are metadata; only `SpokenResponse.text` belongs in the spoken/transcript content.

### Streaming, interruption, reconnection, and fallback

The existing Voice Agent connection remains persistent during normal dialogue. Tone changes do not send `UpdateSpeak` and never reconnect a TTS connection for each sentence. This favors predictable first-audio latency and cross-turn speaker consistency over unverified per-turn numeric controls.

The configured fallback chain is Flux at the requested register → Flux at 0 (when needed) → the existing Aura voice. Deepgram's documented ordered provider fallback applies per synthesis request; warnings mark the turn as neutral fallback. An incompatible initial configuration is retried once with plain Aura settings. All-provider failure ends the session with an error rather than leaving a tool waiting. See [TTS provider fallback](https://developers.deepgram.com/docs/voice-agent-tts-models#using-multiple-tts-providers).

`PcmPlayback` decodes and schedules chunks on one timeline. Barge-in stops every scheduled source, invalidates old callbacks, and rejects incoming audio until the next assistant `ConversationText` response. Playback does not depend on `AgentThinking`, which describes internal reasoning and may be absent from ordinary replies. Repeated assistant text chunks preserve the queued audio. Connection generations discard frames from an old socket. Recoverable socket failures retry at most twice with fresh short-lived tokens. A reconnect sends the last 40 conversation messages through the documented agent context and omits the greeting. It does not replay an interrupted reply. Manual stop aborts authorization, prevents reconnection, and releases the microphone and audio graph.

### File map

| File | Responsibility |
| --- | --- |
| `app/lib/types.ts` | Typed settings, tone, expressivity, spoken response, and metrics |
| `app/lib/emotional-delivery.ts` | Normalization, mappings, prompts, provider chain, context replay, metadata controller |
| `app/lib/pcm-playback.ts` | PCM queue and interruption lifecycle |
| `app/lib/voice-agent-transport.ts` | Protocol handshake, token refresh, retry limits, stale-frame protection |
| `app/lib/use-voice-agent.ts` | Integration with existing microphone, Zustand state, history, and metrics |
| `app/components/emotional-delivery-settings.*` | Expressive TTS controls and session-level explanation |
| `app/components/agent-settings-form.tsx` | Settings form integration |
| `app/stores/session-store.ts`, `workspace-store.ts` | Transient delivery state and validated persistence |
| `app/lib/conversations.ts`, `app/page.tsx` | Response-tone display and latency exports |
| `tests/emotional-delivery.test.mjs`, `voice-agent-streaming.test.mjs` | Delivery, transport, fallback, cancellation, playback regressions |
| `scripts/benchmark-delivery.mjs` | Repeatable local metadata-overhead comparison |

### Validation and latency comparison

The automated suite passes 58 tests, including existing settings/credentials/history tests. New coverage includes every tone mapping, integer validation, missing/malformed LLM metadata, fixed expressivity, fallback configuration and warnings, context replay, token/connection failures, retry exhaustion, stale sockets, user interruptions, PCM scheduling, and safe disposal. Tone fixtures include happy news, sadness, frustration, confusion, and neutral questions. They simulate expected LLM metadata; they do not prove a model inferred a real user's emotional state. TypeScript and full ESLint checks pass. Both automatic and manual settings controls were verified in Chrome. The production build was attempted in the sandbox and with an elevated retry; both hit the existing Turbopack CSS-loader helper-process port-binding restriction (`Operation not permitted`). Production build verification remains incomplete in this environment.

The live Expressive TTS connection was also verified in Chrome using the saved settings key: the agent connected and delivered its greeting, and the verification session was ended. This followed a fix for an `agent.think` parse error: outgoing function definitions must omit `client_side`. Deepgram selects client execution when no function endpoint is present; `client_side` appears on incoming function-call items instead. A regression checks the outgoing definition on both initial connections and reconnects against the [documented Settings contract](https://developers.deepgram.com/reference/voice-agent/voice-agent). Credential storage did not cause that error and remains settings-only Zustand persistence. After fixing the playback gate, two follow-up text prompts were verified in Chrome: each produced assistant responses, entered the speaking state, and queued audio after earlier microphone turns. The verification session was then ended. Automated transport/playback regressions also cover three interrupted replies without any `AgentThinking` event and confirm that stale audio remains blocked until a new assistant response.

`pnpm benchmark:delivery` runs 5,000 local metadata iterations. A measured run produced these times:

| Local work only | p50 | p95 |
| --- | ---: | ---: |
| Baseline text serialization | 0.000167 ms | 0.000250 ms |
| Tone metadata + response serialization | 0.000834 ms | 0.001708 ms |

The run emitted zero synthesis updates/reconnects. These timings exclude network, managed LLM generation/tool continuation, synthesis, and playback. They are not end-to-end response-latency claims, and will vary across machines.

Paired live before/after latency and subjective speech quality are **not measured**; the connection/greeting check does not establish either. The app now records `AgentThinking` → first accepted audio chunk for both Aura baseline and expressive sessions, plus reconnect counts. The response metric uses this first-audio measurement, and transcript exports include the mean and sample count. To compare: run matched conversations with Expressive TTS off and on, use the same network/STT/LLM and comparable prompts, export the sessions, and compare first-audio means and distributions. Greeting audio is excluded. Tool changes may add managed-LLM continuation latency even though there is no extra application-level classifier call.

### Known limitations and follow-up

- This is persistent expressive delivery with automatic conversational style. It does not claim per-utterance numeric expressivity switching or full ElevenLabs-style emotion controls.
- Nonzero registers need human audition; the application cannot verify naturalness, pronunciation, or emotional appropriateness through unit tests.
- Flux and Aura are different model families. A fallback can change the speaker; it is explicitly a recovery path, not an emotion-to-speaker mapping.
- Initial delivery metadata may be absent; neutral is the fallback. Actual provider errors may still terminate a call if every fallback fails.
- Context recovery retains text for the most recent 40 messages, not the exact interrupted audio or outstanding function calls.
- API keys still follow the explicitly requested settings-only/browser-persistence design. No project key is bundled, returned by the server, or added to public environment variables. A strict requirement that even a user-entered key never exist in the browser would require a separate server credential-vault/authentication feature.
- Future work: live pronunciation/quality review, paired network latency trials, broader audited Flux voices, and a separately evaluated per-turn synthesis architecture if session-level delivery is insufficient.
