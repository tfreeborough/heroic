/**
 * The microphone, as a recorder that gives back a WAV.
 *
 * Sound is taken as raw samples (an AudioWorklet tap), not through
 * MediaRecorder: nothing is compressed on the way in, and what comes out is
 * the 48 kHz mono WAV the server wants. The browser's own voice processing
 * (echo cancelling, noise suppression, automatic gain) is switched OFF —
 * it's built for calls, and it makes a good microphone sound like one.
 */
const RATE = 48000;

const TAP = `
class DeskTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.port.onmessage = (e) => { this.on = e.data === "start"; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("desk-tap", DeskTap);
`;

export type MicDevice = { id: string; label: string };

export type Mic = {
  device: string;
  rate: number;
  /** The loudest sample since the last call, 0–1 (for the meter). */
  level: () => number;
  start: () => void;
  /** Stops and returns the recording, or null if nothing was captured. */
  stop: () => { wav: Blob; seconds: number } | null;
  /** Seconds captured so far. */
  elapsed: () => number;
  close: () => void;
};

export const micSupported = (): boolean => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== "undefined";

/** Has the page been allowed the mic before? "prompt" when the browser won't say. */
export const micPermission = async (): Promise<"granted" | "denied" | "prompt"> => {
  try {
    const s = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return s.state;
  } catch {
    return "prompt";
  }
};

/** Inputs by name. Names are blank until the mic has been allowed once. */
export const listMics = async (): Promise<MicDevice[]> => {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
};

const wavOf = (chunks: Float32Array[], rate: number): { wav: Blob; seconds: number } | null => {
  const count = chunks.reduce((n, c) => n + c.length, 0);
  if (!count) return null;
  const buf = new ArrayBuffer(44 + count * 2);
  const v = new DataView(buf);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + count * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, count * 2, true);
  let at = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, at += 2) {
      const s = Math.max(-1, Math.min(1, c[i]!));
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return { wav: new Blob([buf], { type: "audio/wav" }), seconds: count / rate };
};

/** Open a microphone (asks permission the first time). `device` = an id from listMics, or "" for the system's choice. */
export const openMic = async (device: string): Promise<Mic> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: device ? { exact: device } : undefined, channelCount: 1, sampleRate: RATE, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
  try {
    const url = URL.createObjectURL(new Blob([TAP], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw e;
  }
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const tap = new AudioWorkletNode(ctx, "desk-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
  // A node nothing listens to isn't run: route the tap to the speakers at zero.
  const hush = ctx.createGain();
  hush.gain.value = 0;
  source.connect(analyser);
  source.connect(tap);
  tap.connect(hush).connect(ctx.destination);

  let chunks: Float32Array[] = [];
  let captured = 0;
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    chunks.push(e.data);
    captured += e.data.length;
  };
  const scope = new Float32Array(analyser.fftSize);
  return {
    device: stream.getAudioTracks()[0]?.getSettings().deviceId ?? device,
    rate: ctx.sampleRate,
    level: () => {
      analyser.getFloatTimeDomainData(scope);
      let peak = 0;
      for (let i = 0; i < scope.length; i++) peak = Math.max(peak, Math.abs(scope[i]!));
      return Math.min(1, peak);
    },
    start: () => {
      chunks = [];
      captured = 0;
      tap.port.postMessage("start");
    },
    stop: () => {
      tap.port.postMessage("stop");
      const out = wavOf(chunks, ctx.sampleRate);
      chunks = [];
      captured = 0;
      return out;
    },
    elapsed: () => captured / ctx.sampleRate,
    close: () => {
      tap.port.postMessage("stop");
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
};

/** A take's loudness over time, for drawing: the peak of every hundredth of a second, 0–1. */
export const PEAKS_PER_SECOND = 100;
let decoder: AudioContext | null = null;
export const peaksOf = async (url: string): Promise<Float32Array> => {
  decoder ??= new AudioContext();
  const audio = await decoder.decodeAudioData(await (await fetch(url, { cache: "no-store" })).arrayBuffer());
  const data = audio.getChannelData(0);
  const hop = audio.sampleRate / PEAKS_PER_SECOND;
  const out = new Float32Array(Math.ceil(data.length / hop));
  for (let i = 0; i < out.length; i++) {
    let peak = 0;
    for (let k = Math.floor(i * hop), e = Math.min(data.length, Math.floor((i + 1) * hop)); k < e; k++) peak = Math.max(peak, Math.abs(data[k]!));
    out[i] = peak;
  }
  return out;
};
