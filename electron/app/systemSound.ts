/** Linux: Nuvo's playback streams as the system mixer (PulseAudio or PipeWire) holds them, to tell a stream muted there from a silent one. */
import { execFile } from "node:child_process";

export interface MixerInput {
  index: number;
  muted: boolean;
  /** Every channel at 0 %: as silent as a mute. */
  zeroVolume: boolean;
}

export type Pactl = (args: string[]) => Promise<string>;

interface RawInput {
  index?: unknown;
  mute?: unknown;
  volume?: Record<string, { value?: unknown }>;
  properties?: Record<string, unknown>;
}

/** The sink inputs of one process from `pactl -f json list sink-inputs`; Chromium's audio runs in the main process, so its pid owns them. */
export function ownInputs(json: string, pid: number): MixerInput[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return (parsed as RawInput[])
    .filter((input) => typeof input.index === "number" && input.properties?.["application.process.id"] === String(pid))
    .map((input) => {
      const levels = Object.values(input.volume ?? {}).map((channel) => channel.value);
      return { index: input.index as number, muted: input.mute === true, zeroVolume: levels.length > 0 && levels.every((value) => value === 0) };
    });
}

const pactl: Pactl = (args) =>
  new Promise((resolve, reject) => {
    execFile("pactl", args, { timeout: 2000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

/** True when the mixer silences one of Nuvo's streams; null without pactl, without JSON output (pactl before 16) or without a stream. */
export async function systemMuted(pid: number, run: Pactl = pactl): Promise<boolean | null> {
  try {
    const inputs = ownInputs(await run(["-f", "json", "list", "sink-inputs"]), pid);
    if (inputs.length === 0) return null;
    return inputs.some((input) => input.muted || input.zeroVolume);
  } catch {
    return null;
  }
}

/** Lifts the mixer's mute, and a 0 % volume, from Nuvo's streams; the mixer remembers it for the next start too. */
export async function unmuteSystem(pid: number, run: Pactl = pactl): Promise<void> {
  let inputs: MixerInput[];
  try {
    inputs = ownInputs(await run(["-f", "json", "list", "sink-inputs"]), pid);
  } catch {
    return;
  }
  for (const input of inputs) {
    if (input.muted) await run(["set-sink-input-mute", String(input.index), "0"]).catch(() => undefined);
    if (input.zeroVolume) await run(["set-sink-input-volume", String(input.index), "100%"]).catch(() => undefined);
  }
}
