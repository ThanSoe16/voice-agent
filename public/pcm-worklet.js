class PCMRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Int16Array(2048); this.offset = 0; this.energy = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      this.energy += sample * sample;
      if (this.offset === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer.buffer, level: Math.sqrt(this.energy / this.offset) }, [this.buffer.buffer]);
        this.buffer = new Int16Array(2048); this.offset = 0; this.energy = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PCMRecorder);
