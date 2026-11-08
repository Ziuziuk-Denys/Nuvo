/** Fake Web Audio and media elements driven by fake timers. */
import { vi } from "vitest";

type Event = {
  kind: "set" | "target" | "linear" | "curve" | "cancel" | "hold";
  time: number;
  value?: number;
  constant?: number;
  curve?: Float32Array;
  duration?: number;
};

export class FakeParam {
  readonly events: Event[] = [];
  private base: number;
  constructor(
    private readonly ctx: FakeContext,
    initial: number,
  ) {
    this.base = initial;
  }
  get value(): number {
    return this.valueAt(this.ctx.currentTime);
  }
  set value(v: number) {
    this.base = v;
    this.events.length = 0;
    this.directWrites += 1;
  }
  directWrites = 0;
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: "set", time, value });
    return this;
  }
  setTargetAtTime(value: number, time: number, constant: number) {
    this.events.push({ kind: "target", time, value, constant });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: "linear", time, value });
    return this;
  }
  setValueCurveAtTime(curve: Float32Array, time: number, duration: number) {
    this.events.push({ kind: "curve", time, curve: Float32Array.from(curve), duration });
    return this;
  }
  cancelScheduledValues(time: number) {
    const keep = this.events.filter((e) => e.time < time);
    this.events.length = 0;
    this.events.push(...keep);
    return this;
  }
  cancelAndHoldAtTime(time: number) {
    const held = this.valueAt(time);
    this.cancelScheduledValues(time);
    this.events.push({ kind: "set", time, value: held });
    return this;
  }
  /** Evaluates the automation timeline at `time`. */
  valueAt(time: number): number {
    let value = this.base;
    let lastTime = 0;
    const sorted = [...this.events].sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (e.kind === "linear") {
        if (time < e.time) {
          const t = (time - lastTime) / (e.time - lastTime);
          return value + (e.value! - value) * Math.max(0, Math.min(1, t));
        }
        value = e.value!;
        lastTime = e.time;
        continue;
      }
      if (e.time > time) break;
      if (e.kind === "set") value = e.value!;
      if (e.kind === "target") {
        const next = sorted[i + 1];
        const end = next && next.time <= time ? next.time : time;
        value = e.value! + (value - e.value!) * Math.exp(-(end - e.time) / e.constant!);
      }
      if (e.kind === "curve") {
        const progress = Math.min(1, (time - e.time) / e.duration!);
        const index = progress * (e.curve!.length - 1);
        const lo = Math.floor(index);
        const hi = Math.min(e.curve!.length - 1, lo + 1);
        value = e.curve![lo] + (e.curve![hi] - e.curve![lo]) * (index - lo);
      }
      lastTime = e.time;
    }
    return value;
  }
  last(kind: Event["kind"]) {
    return [...this.events].reverse().find((e) => e.kind === kind);
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect(target: FakeNode | FakeParam) {
    if (target instanceof FakeNode) this.outputs.push(target);
    return target;
  }
  disconnect(target?: FakeNode) {
    if (!target) {
      this.outputs.length = 0;
      return;
    }
    const at = this.outputs.indexOf(target);
    if (at >= 0) this.outputs.splice(at, 1);
  }
}

/** Frequency and time-domain data are set by the test; reads copy them like the real node. */
export class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  bytes = new Uint8Array(1024);
  wave = new Float32Array(2048);
  constructor(ctx: FakeContext) {
    super(ctx, "analyser");
  }
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  getByteFrequencyData(out: Uint8Array) {
    out.set(this.bytes.subarray(0, out.length));
  }
  getFloatTimeDomainData(out: Float32Array) {
    out.set(this.wave.subarray(0, out.length));
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(ctx: FakeContext) {
    super(ctx, "gain");
    this.gain = new FakeParam(ctx, 1);
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = "peaking";
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  readonly gain: FakeParam;
  constructor(ctx: FakeContext) {
    super(ctx, "biquad");
    this.frequency = new FakeParam(ctx, 350);
    this.Q = new FakeParam(ctx, 1);
    this.gain = new FakeParam(ctx, 0);
  }
}

export class FakeContext {
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  readonly sampleRate = 48_000;
  state: AudioContextState = "running";
  sinkId = "";
  resumes = 0;
  sourceNodes = new Map<FakeElement, number>();
  readonly audioWorklet = { addModule: vi.fn(async () => undefined) };
  private readonly startMs = Date.now();
  constructor() {
    this.destination = new FakeNode(this, "destination");
  }
  get currentTime(): number {
    return (Date.now() - this.startMs) / 1000;
  }
  baseLatency = 0;
  outputLatency = 0;
  outputStamp = { contextTime: 0, performanceTime: 0 };
  getOutputTimestamp() {
    return this.outputStamp;
  }
  createGain() {
    return new FakeGain(this);
  }
  createBiquadFilter() {
    return new FakeBiquad(this);
  }
  createAnalyser() {
    return new FakeAnalyser(this);
  }
  createConvolver() {
    const node = new FakeNode(this, "convolver") as FakeNode & { buffer: unknown; normalize: boolean };
    node.buffer = null;
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c: number) => data[c] };
  }
  createMediaElementSource(element: FakeElement) {
    if (this.sourceNodes.has(element)) throw new DOMException("already connected", "InvalidStateError");
    this.sourceNodes.set(element, (this.sourceNodes.get(element) ?? 0) + 1);
    return new FakeNode(this, "source");
  }
  async resume() {
    this.resumes += 1;
    this.state = "running";
  }
  async setSinkId(id: string) {
    this.sinkId = id;
  }
  ofType(type: string) {
    return this.nodes.filter((n) => n.kind === type);
  }
}

export class FakeWorkletNode extends FakeNode {
  readonly parameters = new Map<string, FakeParam>();
  readonly port = { postMessage: vi.fn() };
  constructor(ctx: FakeContext) {
    super(ctx, "worklet");
    this.parameters.set("semitones", new FakeParam(ctx, 0));
  }
}

/** Media element whose time advances with fake timers while playing. */
export class FakeElement {
  private source = "";
  get src(): string {
    return this.source;
  }
  /** Setting a source starts loading, as on a real element. */
  set src(value: string) {
    this.source = value;
    this.load();
  }
  crossOrigin: string | null = null;
  preload = "";
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  paused = true;
  readyState = 0;
  duration = Number.NaN;
  error: { code: number } | null = null;
  sinkId = "";
  playLatencyMs = 0;
  rejectPlay: string | null = null;
  playCalls = 0;
  pauseCalls = 0;
  private time = 0;
  private playingSince: number | null = null;
  private listeners = new Map<string, Set<() => void>>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  get currentTime(): number {
    if (this.playingSince === null) return this.time;
    return this.time + ((Date.now() - this.playingSince) / 1000) * this.playbackRate;
  }
  set currentTime(value: number) {
    this.time = value;
    if (this.playingSince !== null) this.playingSince = Date.now();
    queueMicrotask(() => this.dispatch("seeked"));
  }
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  /** Loads `src`: metadata and canplaythrough arrive on the next microtasks. */
  load() {
    this.time = 0;
    this.readyState = 0;
    this.error = null;
    if (!this.src) {
      this.dispatch("emptied");
      return;
    }
    queueMicrotask(() => {
      this.duration = 200;
      this.readyState = 4;
      this.dispatch("loadedmetadata");
      this.dispatch("durationchange");
      this.dispatch("canplay");
      this.dispatch("canplaythrough");
    });
  }
  removeAttribute(name: string) {
    if (name === "src") this.source = "";
  }
  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.playLatencyMs) await new Promise((r) => setTimeout(r, this.playLatencyMs));
    if (this.rejectPlay) {
      const name = this.rejectPlay;
      this.rejectPlay = null;
      throw new DOMException(name, name);
    }
    if (!this.paused) return;
    this.paused = false;
    this.playingSince = Date.now();
    this.dispatch("play");
    this.dispatch("playing");
    this.ticker = setInterval(() => {
      this.dispatch("timeupdate");
      if (this.currentTime >= this.duration) {
        this.pause();
        this.dispatch("ended");
      }
    }, 250);
  }
  pause() {
    this.pauseCalls += 1;
    if (this.paused) return;
    this.time = this.currentTime;
    this.playingSince = null;
    this.paused = true;
    if (this.ticker) clearInterval(this.ticker);
    this.dispatch("pause");
  }
  async setSinkId(id: string) {
    this.sinkId = id;
  }
}
