# Vocal

A Next.js voice testing workspace powered by Deepgram.

## Run locally

1. Install dependencies with `pnpm install`.
2. Set `DEEPGRAM_API_KEY` in `.env.local` (or your existing `.env`). See `.env.example`.
3. Run `pnpm dev` and open the printed local URL.

Keep the API key server-only. The Live Agent mode requires a key with Member or higher permissions to issue short-lived connection tokens, plus Voice Agent access.

## Workspace

- **Speech lab:** record microphone audio, stop to transcribe with Nova-3, and generate MP3 speech with one of four Aura-2 voices. You can also enter text directly.
- **Live agent:** a two-way Voice Agent API session with streamed microphone audio, spoken replies, interruptions, text input, and transcript updates.
- **Agent settings:** change the voice, agent name, greeting, and live agent instructions. Settings are saved in the browser.
- **Session history:** search, revisit, copy, export, and delete transcripts. Up to 100 sessions are stored locally in this browser. Audio recordings are not persisted.

Speech lab transcribes after recording stops. Live Agent mode streams audio continuously while connected. Microphone use requires localhost or HTTPS and browser permission.

## State and forms

Zustand stores are created inside `WorkspaceProvider`, so each rendered workspace has its own state. `app/stores/workspace-store.ts` owns navigation, dialogs, settings, and saved sessions. It keeps the original browser storage keys, preserving existing history and preferences. `session-store.ts` holds transient audio and connection state; the visualizer subscribes to microphone levels separately from the page.

React Hook Form owns the agent settings, speech composer, live message composer, and history search inputs. Audio streams, WebSockets, and playback nodes stay in refs inside the audio hooks. They are never persisted.

## API routes

| Route | Purpose |
| --- | --- |
| `POST /api/transcribe` | Send an audio file as multipart `audio` and receive a transcript. |
| `POST /api/speak` | Send JSON with `text` (up to 1,000 characters) and an optional supported `voice`; receive MP3 audio. |
| `GET /api/deepgram/token` | Check whether the server API key is configured without exposing it. |
| `POST /api/deepgram/token` | Mint a short-lived token for a browser Voice Agent connection. |

The default live agent uses Deepgram Nova-3, a Deepgram-hosted `gpt-4o-mini` thinking model, and Aura-2 speech. No separate model-provider key is needed.

This is a local development workspace. Add authentication and per-user usage controls before exposing the API routes on a shared or public deployment. Local history is browser-specific and is cleared if site storage is deleted.

## Checks

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

This Next.js version enables Cache Components and uses Node.js by default. API route files must not export a `runtime` segment setting. The existing Geist font setup downloads font files during a build, so the first build needs network access.
