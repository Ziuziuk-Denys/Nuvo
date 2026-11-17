export function peaks(pcm: Float32Array, bins: number): number[] {
  const size = Math.max(1, Math.floor(pcm.length / bins));
  const out = Array.from({ length: bins }, (_, bin) => {
    let sum = 0;
    const end = Math.min(pcm.length, (bin + 1) * size);
    for (let i = bin * size; i < end; i++) sum += pcm[i] * pcm[i];
    return Math.sqrt(sum / size);
  });
  const loudest = Math.max(...out);
  return loudest > 0 ? out.map((value) => value / loudest) : out;
}
