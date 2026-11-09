import { LyricsEngine } from "../engine";
import { fakeDaemon, type Step } from "./daemon";
import { fakeAudio, fakeFrames } from "./fakes";

export function setup(scripts: Record<string, Step[]> = {}) {
  const daemon = fakeDaemon(scripts);
  const frames = fakeFrames();
  const audio = fakeAudio();
  const engine = new LyricsEngine({
    stream: daemon.stream,
    saveOffset: daemon.saveOffset,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: () => 0,
  });
  engine.connectAudio(audio);
  return { engine, daemon, frames, audio, state: () => engine.getState() };
}
