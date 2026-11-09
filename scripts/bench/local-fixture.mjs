import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toneWav } from "./stats.mjs";

const ARTISTS = ["Северный ветер", "Зимний сад", "Night Orchard", "Paper Satellites", "Лунный свет", "Field Recorder", "Тихие комнаты", "Blue Harbor"];
const WORDS = ["Утро", "Evening", "Прибой", "Lantern", "Дорога", "Signal", "Тишина", "Garden", "Огни", "Harbor"];

function infoChunk(id, text) {
  const body = Buffer.from(`${text}\0`, "utf8");
  const padded = body.length % 2 ? Buffer.concat([body, Buffer.alloc(1)]) : body;
  const head = Buffer.alloc(8);
  head.write(id, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, padded]);
}

function taggedWav(title, artist, album, track) {
  const wav = toneWav(0.05, 8000);
  const info = Buffer.concat([
    Buffer.from("INFO"),
    infoChunk("INAM", title),
    infoChunk("IART", artist),
    infoChunk("IPRD", album),
    infoChunk("ITRK", String(track)),
  ]);
  const list = Buffer.alloc(8);
  list.write("LIST", 0);
  list.writeUInt32LE(info.length, 4);
  const out = Buffer.concat([wav, list, info]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

export function makeFixture(dir, count = 20_000) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const artist = `${ARTISTS[i % ARTISTS.length]} ${i % 50}`;
    const title = `${WORDS[i % WORDS.length]} ${i}`;
    const folder = path.join(dir, `genre ${i % 7}`, `${artist}`, `Album ${Math.floor(i / 100)}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${String(i % 100).padStart(2, "0")} ${title}.wav`), taggedWav(title, artist, `Album ${Math.floor(i / 100)}`, i % 100));
  }
  const broken = path.join(dir, "broken");
  fs.mkdirSync(broken);
  for (let i = 0; i < 40; i++) {
    const [ext, bytes] = [
      ["mp3", Buffer.from("ID3\x04\x00\x00\x00\x00\x10\x00garbage")],
      ["flac", Buffer.alloc(0)],
      ["m4a", Buffer.from("not an mp4 at all")],
      ["wav", Buffer.from("RIFF\0\0\0\0WAVEfmt ")],
    ][i % 4];
    fs.writeFileSync(path.join(broken, `broken ${i}.${ext}`), bytes);
  }
  fs.symlinkSync(path.join(dir, "genre 0"), path.join(dir, "link to genre 0"));
  execFileSync("mkfifo", [path.join(dir, "pipe.mp3")]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  makeFixture(path.resolve(process.argv[2]), Number(process.argv[3] ?? 20_000));
}
