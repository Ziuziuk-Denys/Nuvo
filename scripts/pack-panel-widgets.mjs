#!/usr/bin/env node
// Own zip writer: build machines lack the gnome-extensions tool
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GNOME_UUID = "nuvo-panel@nuvo.quest";

function filesUnder(dir, rel = "") {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesUnder(dir, child) : [child];
    });
}

// Fixed timestamps keep the zip reproducible
export function zipDirectory(dir) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of filesUnder(dir)) {
    const data = fs.readFileSync(path.join(dir, name));
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    // version 2.0, UTF-8 names, deflate, 1980-01-01 00:00
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function packGnome(outDir = path.join(ROOT, "desktop", "dist")) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${GNOME_UUID}.shell-extension.zip`);
  fs.writeFileSync(file, zipDirectory(path.join(ROOT, "desktop", "gnome-shell", GNOME_UUID)));
  return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(packGnome(process.argv[2]));
