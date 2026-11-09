#!/usr/bin/env node
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const dir = path.resolve(option("--dir") ?? path.join(os.homedir(), ".local/opt/Nuvo"));
const maxRss = option("--max-rss") === undefined ? Infinity : Number(option("--max-rss"));
const maxPss = option("--max-pss") === undefined ? Infinity : Number(option("--max-pss"));

function readKb(text, field) {
  const match = text.match(new RegExp(`^${field}:\\s+(\\d+) kB`, "m"));
  return match ? Number(match[1]) : 0;
}

function processKind(pid) {
  const args = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/); // forked Chromium children rewrite argv as one space-joined string
  const type = args.find((arg) => arg.startsWith("--type="));
  if (type) return type.slice("--type=".length);
  return path.basename(args[0]) === "nuvo-core" ? "core" : "main";
}

const rows = [];
for (const entry of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const exe = fs.readlinkSync(`/proc/${entry}/exe`);
    if (!exe.startsWith(dir + path.sep)) continue;
    const rollup = fs.readFileSync(`/proc/${entry}/smaps_rollup`, "utf8");
    rows.push({ pid: Number(entry), kind: processKind(entry), rssKb: readKb(rollup, "Rss"), pssKb: readKb(rollup, "Pss") });
  } catch {}
}

const mb = (kb) => Math.round((kb / 1024) * 10) / 10;
const total = { rss: mb(rows.reduce((s, r) => s + r.rssKb, 0)), pss: mb(rows.reduce((s, r) => s + r.pssKb, 0)) };
const kinds = {};
for (const row of rows) {
  kinds[row.kind] ??= { count: 0, rssKb: 0, pssKb: 0 };
  kinds[row.kind].count += 1;
  kinds[row.kind].rssKb += row.rssKb;
  kinds[row.kind].pssKb += row.pssKb;
}
const byKind = Object.fromEntries(Object.entries(kinds).map(([kind, v]) => [kind, { count: v.count, rss: mb(v.rssKb), pss: mb(v.pssKb) }]));

if (rows.length === 0) {
  console.error(`no running process from ${dir}`);
  process.exit(2);
}
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ dir, processes: rows.length, ...total, byKind }));
} else {
  console.log(`Nuvo: RSS ${total.rss} MB, PSS ${total.pss} MB, ${rows.length} processes`);
  for (const [kind, v] of Object.entries(byKind)) console.log(`  ${kind}: ${v.count} x, RSS ${v.rss} MB, PSS ${v.pss} MB`);
}
if (total.rss > maxRss || total.pss > maxPss) {
  console.error(`over budget: RSS ${total.rss}/${maxRss} MB, PSS ${total.pss}/${maxPss} MB`);
  process.exit(1);
}
