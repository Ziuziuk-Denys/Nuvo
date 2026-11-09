import fs from "node:fs";

const [file, specifier] = process.argv.slice(2);
if (!file || !specifier) {
  console.error("usage: node scripts/cut-export.mjs <file> <specifier>");
  process.exit(2);
}
const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const statement = new RegExp(`^export\\s+(?:type\\s+)?(?:\\*(?:\\s+as\\s+\\w+)?|\\{[^}]*\\})\\s*from\\s*["']${escaped}["'];?[ \\t]*\\r?\\n?`, "gm");
const text = fs.readFileSync(file, "utf8");
const count = text.match(statement)?.length ?? 0;
if (count === 0) {
  console.error(`no export from ${specifier} in ${file}`);
  process.exit(1);
}
fs.writeFileSync(file, text.replace(statement, ""));
console.log(`removed ${count} export statement(s) from ${file}`);
