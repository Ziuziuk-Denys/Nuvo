// The first input keeps its top-level path and sha512, which old updaters read
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function filesBlock(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("files:");
  if (start < 0) throw new Error("feed has no files: list");
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("  ")) end++;
  return { lines, start, end };
}

export function mergeFeeds(texts) {
  if (texts.length === 0) throw new Error("no feeds");
  const versions = new Set(texts.map((text) => /^version: (.+)$/m.exec(text)?.[1]));
  if (versions.size !== 1 || versions.has(undefined)) throw new Error(`feeds disagree on the version: ${[...versions].join(", ")}`);
  const base = filesBlock(texts[0]);
  const extra = texts.slice(1).flatMap((text) => {
    const block = filesBlock(text);
    return block.lines.slice(block.start + 1, block.end);
  });
  return [...base.lines.slice(0, base.end), ...extra, ...base.lines.slice(base.end)].join("\n");
}

// realpath: a symlinked script path still counts as running this file
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...inputs] = process.argv.slice(2);
  fs.writeFileSync(output, mergeFeeds(inputs.map((file) => fs.readFileSync(file, "utf8"))));
}
