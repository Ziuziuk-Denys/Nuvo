/** AudioWorklet wrapper around the phase-vocoder pitch shifter. Loaded with `audioWorklet.addModule`. */
import { PhaseVocoderShifter } from "./phaseVocoder";

// Minimal declarations of the AudioWorkletGlobalScope (not part of the DOM lib).
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

export const PITCH_PROCESSOR = "nuvo-pitch";

class NuvoPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "semitones", defaultValue: 0, minValue: -12, maxValue: 12, automationRate: "k-rate" }];
  }

  private readonly shifter = new PhaseVocoderShifter();

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }
    this.shifter.setSemitones(parameters.semitones[0] ?? 0);
    this.shifter.process(input, output);
    return true;
  }
}

registerProcessor(PITCH_PROCESSOR, NuvoPitchProcessor);
