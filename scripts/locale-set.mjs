#!/usr/bin/env node
// Sets dotted keys in a locale file: node scripts/locale-set.mjs en '{"ui.settings.storage_web":"Web cache"}'
import fs from "node:fs";

const [locale, json] = process.argv.slice(2);
if (!/^(en|ru)$/.test(locale ?? "") || !json) {
  console.error("usage: locale-set.mjs <en|ru> '<json>'");
  process.exit(2);
}
const file = `src/i18n/locales/${locale}.json`;
const data = JSON.parse(fs.readFileSync(file, "utf8"));
for (const [key, value] of Object.entries(JSON.parse(json))) {
  const parts = key.split(".");
  let node = data;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
