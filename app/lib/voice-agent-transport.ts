export type AgentEvent = Record<string, unknown> & { type: string };
type Socket = Pick<WebSocket, "readyState" | "bufferedAmount" | "binaryType" | "send" | "close"> & {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};
type Options = {
  token: () => Promise<string>;
  settings: (resuming: boolean) => object;
  onReady: (resuming: boolean) => void;
  onMessage: (message: AgentEvent) => void;
  onAudio: (audio: ArrayBuffer) => void;
  onReconnecting: (attempt: number) => void;
  onFatal: (message: string) => void;
  onEnd: () => void;
  socketFactory?: (url: string, protocols: string[]) => Socket;
};

export class VoiceAgentTransport {
  private socket?: Socket;
  private epoch = 0;
  private disposed = false;
  private ready = false;
  private connectedOnce = false;
  private retries = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private keepAlive?: ReturnType<typeof setInterval>;
  private lastAudioAt = 0;
  private opening = false;
  constructor(private options: Options) {}
  connect() { if (!this.disposed && !this.socket && !this.opening) void this.open(); }

  private async open() {
    this.opening = true;
    const epoch = ++this.epoch;
    try {
      // Refresh the temporary token for every reconnect; never reuse an expired JWT.
      const token = await this.options.token();
      if (this.disposed || epoch !== this.epoch) return;
      const socket = this.options.socketFactory?.("wss://agent.deepgram.com/v1/agent/converse", ["bearer", token])
        ?? new WebSocket("wss://agent.deepgram.com/v1/agent/converse", ["bearer", token]);
      this.socket = socket;
      this.opening = false;
      socket.binaryType = "arraybuffer";
      const current = () => !this.disposed && epoch === this.epoch;
      let welcomed = false;
      this.timer = setTimeout(() => { if (current()) this.recover("Deepgram took too long to connect."); }, 20000);
      socket.onmessage = event => {
        if (!current()) return;
        if (event.data instanceof ArrayBuffer) { if (this.ready) this.options.onAudio(event.data); return; }
        let message: unknown;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (!message || typeof message !== "object" || !("type" in message) || typeof message.type !== "string") return;
        const eventMessage = message as AgentEvent;
        if (eventMessage.type === "Welcome" && !welcomed) {
          welcomed = true;
          this.send(this.options.settings(this.connectedOnce));
        } else if (eventMessage.type === "SettingsApplied" && welcomed && !this.ready) {
          clearTimeout(this.timer);
          const resuming = this.connectedOnce;
          this.ready = true;
          this.connectedOnce = true;
          this.retries = 0;
          this.lastAudioAt = Date.now();
          this.keepAlive = setInterval(() => {
            if (this.ready && Date.now() - this.lastAudioAt >= 8000) this.send({ type: "KeepAlive" });
          }, 8000);
          this.options.onReady(resuming);
        } else if (this.ready || eventMessage.type === "Error" || eventMessage.type === "Warning") this.options.onMessage(eventMessage);
      };
      socket.onerror = () => { if (current()) this.recover("Unable to connect to Deepgram."); };
      socket.onclose = event => {
        if (!current()) return;
        if (event.code === 1000) { this.close(); this.options.onEnd(); }
        else this.recover("The connection ended unexpectedly.");
      };
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      this.close();
      this.options.onFatal(error instanceof Error ? error.message : "Could not authorize the voice connection.");
    }
  }

  private detach() {
    this.opening = false;
    this.ready = false;
    this.epoch++;
    clearTimeout(this.timer);
    clearInterval(this.keepAlive);
    if (this.socket) {
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = undefined;
    }
  }
  private recover(reason: string) {
    this.detach();
    if (++this.retries > 2) {
      this.disposed = true;
      this.options.onFatal(`${reason} Please try again. Your transcript has been saved.`);
      return;
    }
    this.options.onReconnecting(this.retries);
    this.timer = setTimeout(() => { if (!this.disposed) void this.open(); }, 500 * this.retries);
  }
  send(message: object): boolean {
    if (this.disposed || this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  sendAudio(audio: ArrayBuffer): boolean {
    if (!this.ready || this.disposed || this.socket?.readyState !== 1 || this.socket.bufferedAmount >= 256000) return false;
    this.socket.send(audio);
    this.lastAudioAt = Date.now();
    return true;
  }
  restart() { if (!this.disposed) this.recover("The voice configuration could not be applied."); }
  close() { this.disposed = true; this.detach(); }
}
