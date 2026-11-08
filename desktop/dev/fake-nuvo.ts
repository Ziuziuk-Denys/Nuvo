/**
 * A stand-in Nuvo for working on the panel widgets: the real quest.nuvo.Nuvo.Player service plus a small MPRIS player
 * with two songs, covers, likes and timed lyrics. Run it on a private bus, never next to a running Nuvo:
 *   dbus-run-session -- node --experimental-transform-types desktop/dev/fake-nuvo.ts
 * Needs Node 23.6 or newer (TypeScript transforms and module hooks).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

// the app's sources import without extensions, the way the bundler resolves them
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const { BusConnection, socketPathOf } = await import("../../electron/app/dbus.ts");
const { startPanelBus } = await import("../../electron/app/panelBus.ts");
type Message = import("../../electron/app/dbus.ts").Message;
type SurfaceState = import("../../src/engine/types.ts").SurfaceState;

function png(size: number, from: number[], to: number[]): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      for (let c = 0; c < 3; c++) raw[y * (size * 3 + 1) + 1 + x * 3 + c] = Math.round(from[c] + (to[c] - from[c]) * t);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const coverDir = path.join(homedir(), ".cache", "nuvo-fake-covers");
mkdirSync(coverDir, { recursive: true });
const songs = [
  {
    id: "fake:1",
    title: "Northern Lights Over the Quiet Harbour",
    artist: "Mira Vale",
    album: "Harbour",
    lengthMs: 214_000,
    colors: [
      [255, 94, 98],
      [255, 195, 113],
    ],
  },
  {
    id: "fake:2",
    title: "Glass",
    artist: "Odd Weather",
    album: "Seasons",
    lengthMs: 187_000,
    colors: [
      [40, 90, 220],
      [120, 220, 255],
    ],
  },
].map((song, index) => {
  const file = path.join(coverDir, `cover-${index + 1}.png`);
  writeFileSync(file, png(256, song.colors[0], song.colors[1]));
  return { ...song, artUrl: `file://${file}` };
});
const lyrics = ["Light on the water", "I kept the radio low", "Somewhere a song begins", "And we drift where the colours go"];

let index = 0;
let playing = true;
let positionMs = 42_000;
let sampledAt = Date.now();
const liked = new Set<string>();

const position = () => Math.min(songs[index].lengthMs, positionMs + (playing ? Date.now() - sampledAt : 0));
const settle = () => {
  positionMs = position();
  sampledAt = Date.now();
};

const socket = socketPathOf(process.env.DBUS_SESSION_BUS_ADDRESS);
if (!socket) throw new Error("no session bus: run under dbus-run-session");
const mpris = await BusConnection.open(socket, process.getuid?.() ?? 0);
const mprisName = `org.mpris.MediaPlayer2.chromium.instance${process.pid}`;
const panel = await startPanelBus({
  mprisName,
  now: Date.now,
  show: () => console.log("[fake] Show"),
  command: (command) => {
    console.log("[fake] command", command.type);
    const id = songs[index].id;
    if (command.type === "like") liked.add(id);
    if (command.type === "unlike") liked.delete(id);
    if (command.type === "dislike") skip(1);
    publish();
  },
});
if (!panel) throw new Error("quest.nuvo.Nuvo.Player is taken: is a real Nuvo running on this bus?");

function state(): SurfaceState {
  const song = songs[index];
  return {
    trackId: song.id,
    title: song.title,
    artists: song.artist,
    durationMs: song.lengthMs,
    positionMs: position(),
    sampledAt: Date.now(),
    status: playing ? "playing" : "paused",
    liked: liked.has(song.id),
    source: "local",
    upNext: [],
  };
}

const metadata = () => {
  const song = songs[index];
  return [
    ["mpris:trackid", ["o", `/quest/nuvo/fake/${index + 1}`]],
    ["xesam:title", ["s", song.title]],
    ["xesam:artist", ["as", [song.artist]]],
    ["xesam:album", ["s", song.album]],
    ["mpris:length", ["x", song.lengthMs * 1000]],
    ["mpris:artUrl", ["s", song.artUrl]],
  ];
};

const playerProperties = () => [
  ["PlaybackStatus", ["s", playing ? "Playing" : "Paused"]],
  ["Metadata", ["a{sv}", metadata()]],
  ["Position", ["x", position() * 1000]],
  ["CanGoNext", ["b", true]],
  ["CanGoPrevious", ["b", true]],
  ["CanPlay", ["b", true]],
  ["CanPause", ["b", true]],
  ["CanSeek", ["b", true]],
  ["CanControl", ["b", true]],
  ["Rate", ["d", 1]],
];
const rootProperties = () => [
  ["Identity", ["s", "Nuvo"]],
  ["CanRaise", ["b", false]],
  ["CanQuit", ["b", false]],
  ["HasTrackList", ["b", false]],
];

function publish(): void {
  panel!.service.update(state());
  mpris.signal({
    path: "/org/mpris/MediaPlayer2",
    interface: "org.freedesktop.DBus.Properties",
    member: "PropertiesChanged",
    signature: "sa{sv}as",
    body: ["org.mpris.MediaPlayer2.Player", playerProperties().filter(([key]) => key !== "Position"), []],
  });
}

function skip(step: number): void {
  index = (index + step + songs.length) % songs.length;
  positionMs = 0;
  sampledAt = Date.now();
  panel!.service.setLyrics({ trackId: songs[index].id, lines: lyrics.map((text, n) => ({ timeMs: n * 4000, text })) });
}

mpris.onCall = (call: Message) => {
  const where = `${call.interface}.${call.member}`;
  if (where === "org.freedesktop.DBus.Properties.GetAll") {
    return mpris.reply(call, "a{sv}", [call.body?.[0] === "org.mpris.MediaPlayer2" ? rootProperties() : playerProperties()]);
  }
  if (where === "org.freedesktop.DBus.Properties.Get") {
    const found = [...rootProperties(), ...playerProperties()].find(([key]) => key === call.body?.[1]);
    return found ? mpris.reply(call, "v", [found[1]]) : mpris.error(call, "org.freedesktop.DBus.Error.UnknownProperty", "unknown");
  }
  const actions: Record<string, () => void> = {
    "org.mpris.MediaPlayer2.Player.PlayPause": () => ((playing = !playing), settle()),
    "org.mpris.MediaPlayer2.Player.Play": () => ((playing = true), settle()),
    "org.mpris.MediaPlayer2.Player.Pause": () => ((playing = false), settle()),
    "org.mpris.MediaPlayer2.Player.Next": () => skip(1),
    "org.mpris.MediaPlayer2.Player.Previous": () => skip(-1),
  };
  const action = actions[where];
  if (!action) return mpris.error(call, "org.freedesktop.DBus.Error.UnknownMethod", where);
  settle();
  action();
  console.log("[fake]", call.member);
  mpris.reply(call);
  publish();
};

const [code] = await mpris.call({
  destination: "org.freedesktop.DBus",
  path: "/org/freedesktop/DBus",
  interface: "org.freedesktop.DBus",
  member: "RequestName",
  signature: "su",
  body: [mprisName, 4],
});
if (code !== 1) throw new Error(`${mprisName} is taken`);
liked.add(songs[0].id);
panel.service.setLyrics({ trackId: songs[0].id, lines: lyrics.map((text, n) => ({ timeMs: 40_000 + n * 4000, text })) });
publish();
console.log(`[fake] Nuvo on ${mprisName}`);
