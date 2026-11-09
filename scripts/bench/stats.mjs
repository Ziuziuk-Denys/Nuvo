export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export function summarize(values, digits = 1) {
  if (values.length === 0) return null;
  return {
    n: values.length,
    p50: round(median(values), digits),
    p95: round(percentile(values, 95), digits),
    min: round(Math.min(...values), digits),
    max: round(Math.max(...values), digits),
  };
}

export function readKb(text, field) {
  return Number(text.match(new RegExp(`^${field}:\\s+(\\d+) kB`, "m"))?.[1] ?? 0);
}

// The command name in /proc/<pid>/stat may hold spaces
export function parseStat(text) {
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return { parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]) };
}

export function frameStats(gaps) {
  return {
    frames: gaps.length,
    p50: round(median(gaps), 2),
    p95: round(percentile(gaps, 95), 2),
    worst: round(Math.max(...gaps), 2),
    slowShare: round(gaps.filter((gap) => gap > 20).length / gaps.length, 4),
  };
}

export function toneWav(seconds, rate = 16_000) {
  const samples = Math.round(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function markdownTable(rows) {
  const lines = ["| Measurement | Unit | n | p50 | p95 | min-max |", "|---|---|---|---|---|---|"];
  for (const [label, unit, stats] of rows) {
    if (typeof stats === "string") lines.push(`| ${label} | ${unit} | - | ${stats} | - | - |`);
    else if (!stats) lines.push(`| ${label} | ${unit} | 0 | not measured | - | - |`);
    else lines.push(`| ${label} | ${unit} | ${stats.n} | ${stats.p50} | ${stats.p95} | ${stats.min}-${stats.max} |`);
  }
  return lines.join("\n");
}
