// One ordered PCM queue. A barge-in invalidates both scheduled sources and their
// onended callbacks; late audio is ignored until the next assistant response.
export class PcmPlayback {
  private sources = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private generation = 0;
  private accepting = true;
  constructor(private context: AudioContext, private onIdle: () => void, private onPlaying: () => void) {}
  get pending() { return this.sources.size; }
  beginTurn() { this.accepting = true; }
  handleEvent(event: { type: string; role?: unknown; content?: unknown }) {
    if (event.type === "UserStartedSpeaking") this.interrupt();
    // AgentThinking describes non-verbalized reasoning, not every spoken reply.
    // ConversationText precedes the corresponding response audio, including
    // ordinary replies with no thinking/tool event. Repeated text chunks must
    // keep the existing audio queue intact.
    else if (event.type === "ConversationText" && event.role === "assistant" && typeof event.content === "string" && event.content.length) this.beginTurn();
  }
  interrupt() {
    this.accepting = false;
    this.generation++;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } }
    this.sources.clear();
    this.nextAudio = 0;
  }
  queue(data: ArrayBuffer): boolean {
    if (!this.accepting || this.context.state === "closed" || !data.byteLength || data.byteLength % 2) return false;
    const generation = this.generation;
    const pcm = new Int16Array(data);
    const buffer = this.context.createBuffer(1, pcm.length, 24000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const when = Math.max(this.context.currentTime + 0.015, this.nextAudio);
    this.nextAudio = when + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (generation === this.generation && !this.sources.size) this.onIdle();
    };
    source.start(when);
    this.onPlaying();
    return true;
  }
}
