import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const SHOTS = path.join(os.homedir(), ".cache", "words-shots");
const SONG = {
  id: "fixture-words",
  title: "Morning Light",
  artists: "Nova",
  coverUrl: "",
  durationMs: 60_000,
};
/** Lit before its start: half a tick by design, plus the frame the read waits for. */
const EARLY_MS = 40;
/** Still lit after its end: the hold over a short gap, a tick and a frame. */
const LATE_MS = 200;

function fixtureLrc(): string {
  const texts = [
    ["Morning ", "light ", "over ", "the ", "hill"],
    ["Над ", "тихою ", "рекою ", "снова ", "рассвет"],
    ["Supercalifragilisticexpialidocious ", "antidisestablishmentarianism ", "again"],
    ["שלום ", "עולם ", "יפה ", "מאוד"],
    ["君", "の", "名", "前", "を", "呼", "ん", "で", "い", "る", "夜", "の", "空", "に", "響", "く", "声", "が", "す", "る"],
  ];
  const stamp = (ms: number) =>
    `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}`;
  const lines: string[] = [];
  for (let at = 1000, row = 0; at < 55_000; row += 1) {
    const words = texts[row % texts.length];
    const step = Math.round(3600 / words.length / 10) * 10;
    lines.push(`[${stamp(at)}]${words.map((word, index) => `<${stamp(at + index * step)}>${word}`).join("")}<${stamp(at + words.length * step)}>`);
    at += 4000;
  }
  return lines.join("\n");
}

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;
let provider: http.Server;

function toneWav(seconds: number): Buffer {
  const rate = 48_000;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 4000), i * 2);
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

interface Sample {
  lit: number;
  earlyMs: number;
  lateMs: number;
  latencyMs: number;
}

function record(ms: number): Promise<Sample[]> {
  return main.evaluate((duration) => {
    type Decks = {
      clock: { activeElement(): HTMLMediaElement };
      audioContext: AudioContext | null;
    };
    const { decks } = (window as unknown as { __nuvoPlayer: { decks: Decks } }).__nuvoPlayer;
    return new Promise<Sample[]>((resolve) => {
      const samples: Sample[] = [];
      const started = performance.now();
      const frame = (now: number) => {
        const media = decks.clock.activeElement();
        const context = decks.audioContext;
        const latencyMs = context ? (context.baseLatency + context.outputLatency) * 1000 : 0;
        const heardMs = media.currentTime * 1000 - latencyMs * media.playbackRate;
        const lit = document.querySelectorAll<HTMLElement>("braccato-lyrics [data-nuvo-now]");
        const word = lit[0];
        const fromMs = word ? Number(word.dataset.time) * 1000 : heardMs;
        const toMs = word ? fromMs + Number(word.dataset.duration) * 1000 : heardMs;
        samples.push({ lit: lit.length, earlyMs: fromMs - heardMs, lateMs: heardMs - toMs, latencyMs });
        if (now - started < duration) requestAnimationFrame(frame);
        else resolve(samples);
      };
      requestAnimationFrame(frame);
    });
  }, ms);
}

function summary(samples: Sample[]) {
  return {
    frames: samples.length,
    litFrames: samples.filter((sample) => sample.lit > 0).length,
    mostLit: Math.max(...samples.map((sample) => sample.lit)),
    earliestMs: Math.max(...samples.map((sample) => sample.earlyMs)),
    latestMs: Math.max(...samples.map((sample) => sample.lateMs)),
    latencyMs: samples.at(-1)?.latencyMs,
  };
}

function report(name: string, samples: Sample[]) {
  const result = summary(samples);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.appendFileSync(path.join(SHOTS, "accuracy.log"), `${name}: ${JSON.stringify(result)}\n`);
  return result;
}

function expectOneWordOnTime(result: ReturnType<typeof summary>) {
  expect(result.mostLit).toBe(1);
  expect(result.earliestMs).toBeLessThan(EARLY_MS);
  expect(result.latestMs).toBeLessThan(LATE_MS);
}

function litOrder(ms: number): Promise<number[]> {
  return main.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const watcher = new MutationObserver((changes) => {
          for (const change of changes) {
            const word = change.target as HTMLElement;
            const time = Math.round(Number(word.dataset.time) * 1000);
            if ((word.hasAttribute("data-nuvo-now") || word.hasAttribute("data-nuvo-fill")) && !seen.includes(time)) seen.push(time);
          }
        });
        watcher.observe(document.querySelector("braccato-lyrics")!, { subtree: true, attributes: true, attributeFilter: ["data-nuvo-now", "data-nuvo-fill"] });
        setTimeout(() => {
          watcher.disconnect();
          resolve(seen);
        }, duration);
      }),
    ms,
  );
}

const player = (script: string) => main.evaluate(`window.__nuvoPlayer.engine.${script}`);

async function chooseMode(label: string) {
  await main.locator('[role="group"][aria-label="Highlight"] button', { hasText: label }).click({ force: true });
  await main.waitForTimeout(250);
}

function litNow() {
  return main.evaluate(() => {
    const text = (element: Element) => element.textContent!.trim();
    const filling = document.querySelector<HTMLElement>("braccato-lyrics [data-nuvo-fill]");
    return {
      words: [...document.querySelectorAll("braccato-lyrics .blyrics--word[data-nuvo-now]")].map(text),
      lines: document.querySelectorAll("braccato-lyrics .blyrics--line[data-nuvo-now]").length,
      filling: filling ? text(filling) : null,
      progress: Number(filling?.style.getPropertyValue("--nuvo-fill") || 0),
    };
  });
}

function latencyMs(): Promise<number> {
  return main.evaluate(() => {
    const context = (window as unknown as { __nuvoPlayer: { decks: { audioContext: AudioContext | null } } }).__nuvoPlayer.decks.audioContext;
    return context ? (context.baseLatency + context.outputLatency) * 1000 : 0;
  });
}

async function pausedAt(ms: number) {
  await player(`seekTo(${ms + (await latencyMs())})`);
  await main.waitForTimeout(350);
  return litNow();
}

beforeAll(async () => {
  const lrc = fixtureLrc();
  provider = http.createServer((request, response) => {
    const record = {
      id: 1,
      trackName: SONG.title,
      artistName: SONG.artists,
      duration: SONG.durationMs / 1000,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: lrc,
    };
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/api/get")) response.end(JSON.stringify(record));
    else if (request.url?.startsWith("/api/search")) response.end(JSON.stringify([record]));
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const { port } = provider.address() as { port: number };
  isolation = isolate("nuvo-words-e2e");
  isolation.env.NUVO_CORE_LRCLIB_URL = `http://127.0.0.1:${port}`;
  isolation.env.NUVO_CORE_AMLL_URL = "";
  const audible = process.env.NUVO_WORDS_AUDIBLE === "1";
  // silent runs use Chromium's fake output: the sound server's latency moves with other programs, by up to 400 ms
  const args = [ROOT, "--ozone-platform=x11", ...(audible ? [] : ["--mute-audio", "--disable-audio-output"]), `--user-data-dir=${isolation.userData}`];
  app = await _electron.launch({
    executablePath: ELECTRON,
    args,
    cwd: ROOT,
    env: isolation.env,
  });
  main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.nuvoShell));
  await main.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics), undefined, { timeout: 60_000 });
  await main.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
  const wav = toneWav(60).toString("base64");
  const status = await main.evaluate(
    async ({ id, wav }) => {
      const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
      const response = await fetch(`nuvo-core://local/v1/cache/audio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "audio/wav", "X-Nuvo-Codec": "pcm" },
        body: bytes,
      });
      return response.status;
    },
    { id: SONG.id, wav },
  );
  expect(status).toBeLessThan(300);
  await main.evaluate(() =>
    (
      window as unknown as {
        __nuvoPlayer: { decks: { setVolume(gain: number): void } };
      }
    ).__nuvoPlayer.decks.setVolume(0),
  );
  await main.evaluate(
    (song) =>
      (
        window as unknown as {
          __nuvoPlayer: { engine: { playList(tracks: unknown[]): void } };
        }
      ).__nuvoPlayer.engine.playList([song]),
    SONG,
  );
  await main.evaluate(() => {
    location.hash = "#/player";
  });
  await main.locator("braccato-lyrics .blyrics--line").first().waitFor({ timeout: 30_000 });
}, 120_000);

afterAll(async () => {
  const pid = app?.process().pid;
  await app?.close().catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  provider?.close();
  isolation?.dispose();
});

afterEach(async ({ task }) => {
  if (task.result?.state !== "fail") return;
  await main.emulateMedia({ reducedMotion: "no-preference" });
  await main.evaluate(() => (window as unknown as { __nuvoLyrics: { clearOffset(): void } }).__nuvoLyrics.clearOffset());
  await player("setTempo({ rate: 1 })");
  await player("play()");
  await chooseMode("Word");
});

it("a song with word timing opens in word mode, marked word level", async () => {
  const state = await main.evaluate(() => {
    const lyrics = (
      window as unknown as {
        __nuvoLyrics: {
          getState(): {
            wordTimed: boolean;
            versions: Array<{ syncLevel: string }>;
          };
        };
      }
    ).__nuvoLyrics.getState();
    return { wordTimed: lyrics.wordTimed, version: lyrics.versions[0] };
  });
  expect(state).toMatchObject({ wordTimed: true, version: { syncLevel: "word_level" } });
  expect(await main.locator('[role="group"][aria-label="Highlight"] button[aria-pressed="true"]').allTextContents()).toEqual(["Fill"]);
});

it("each mode lights exactly its set of words at a given time, and a seek back un-lights the rest", async () => {
  await player("pause()");
  // line 1 at 1000 ms: Morning 1000, light 1720, over 2440, the 3160, hill 3880; line 2 from 5000 ms
  await chooseMode("Word");
  expect(await pausedAt(2800)).toEqual({ words: ["over"], lines: 0, filling: null, progress: 0 });
  expect(await pausedAt(1300)).toEqual({ words: ["Morning"], lines: 0, filling: null, progress: 0 });

  await chooseMode("Step");
  expect(await pausedAt(2800)).toEqual({ words: ["Morning", "light", "over"], lines: 0, filling: null, progress: 0 });
  expect(await pausedAt(1300)).toEqual({ words: ["Morning"], lines: 0, filling: null, progress: 0 });
  expect(await pausedAt(5300)).toEqual({ words: ["Над"], lines: 0, filling: null, progress: 0 });
  expect(await pausedAt(800)).toEqual({ words: [], lines: 0, filling: null, progress: 0 });

  await chooseMode("Fill");
  const forward = await pausedAt(2800);
  expect(forward).toMatchObject({ words: ["Morning", "light"], lines: 0, filling: "over" });
  expect(forward.progress).toBeGreaterThan(0.2);
  expect(forward.progress).toBeLessThan(0.6);
  const back = await pausedAt(1300);
  expect(back).toMatchObject({ words: [], lines: 0, filling: "Morning" });
  expect(await pausedAt(800)).toEqual({ words: [], lines: 0, filling: null, progress: 0 });

  await chooseMode("Line");
  expect(await pausedAt(2800)).toEqual({ words: [], lines: 1, filling: null, progress: 0 });
  expect(await pausedAt(800)).toEqual({ words: [], lines: 0, filling: null, progress: 0 });

  await chooseMode("Word");
  await player("play()");
});

it("only the word being sung is lit, on time, while playing", async () => {
  await main.waitForTimeout(1_500);
  const result = report("steady", await record(8_000));
  expect(result.frames).toBeGreaterThan(200);
  expect(result.litFrames).toBeGreaterThan(100);
  expectOneWordOnTime(result);
});

it.each(["Word", "Step", "Fill"])("%s: every word gets its turn, in order, also the 180 ms ones", async (mode) => {
  await chooseMode(mode);
  await player("seekTo(16900)");
  await main.waitForTimeout(150);
  const order = await litOrder(3_900);
  const times = await main.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("braccato-lyrics .blyrics--word:not(.blyrics-word-highlight)")].map((word) =>
      Math.round(Number(word.dataset.time) * 1000),
    ),
  );
  const wanted = times.filter((time) => time >= order[0] && time <= order.at(-1)!);
  expect(wanted.length).toBeGreaterThan(15);
  expect(order).toEqual(wanted);
  await chooseMode("Word");
});

it("after a seek, forward and back, the word there is lit and nothing else", async () => {
  await player("seekTo(30500)");
  await main.waitForTimeout(400);
  const forward = report("seek forward", await record(3_000));
  expect(forward.frames).toBeGreaterThan(60);
  expectOneWordOnTime(forward);
  await player("seekTo(9500)");
  await main.waitForTimeout(400);
  const back = report("seek back", await record(3_000));
  expect(back.frames).toBeGreaterThan(60);
  expectOneWordOnTime(back);
});

it("a seek while paused moves the mark to the word there", async () => {
  await player("pause()");
  await player(`seekTo(${1950 + (await latencyMs())})`);
  await main.waitForTimeout(500);
  const result = report("paused seek", await record(300));
  expectOneWordOnTime(result);
  expect(result.litFrames).toBe(result.frames);
  await player("play()");
});

it("at another speed the word stays on time", async () => {
  await player("setTempo({ rate: 1.25 })");
  await main.waitForTimeout(600);
  const fast = report("rate 1.25", await record(4_000));
  expect(fast.frames).toBeGreaterThan(100);
  expectOneWordOnTime(fast);
  await player("setTempo({ rate: 0.75 })");
  await main.waitForTimeout(600);
  const slow = report("rate 0.75", await record(4_000));
  expectOneWordOnTime(slow);
  await player("setTempo({ rate: 1 })");
});

it("the owner's offset moves the mark with the words", async () => {
  await main.evaluate(() => (window as unknown as { __nuvoLyrics: { nudgeOffset(ms: number): void } }).__nuvoLyrics.nudgeOffset(300));
  await main.waitForTimeout(600);
  const result = report("offset +300", await record(3_000));
  expect(result.frames).toBeGreaterThan(60);
  expectOneWordOnTime(result);
  await main.evaluate(() => (window as unknown as { __nuvoLyrics: { clearOffset(): void } }).__nuvoLyrics.clearOffset());
});

it("pause holds the mark still, resume goes on from there", async () => {
  await player("seekTo(5400)");
  await main.waitForTimeout(800);
  await player("pause()");
  await main.waitForTimeout(600);
  const read = () => main.evaluate(() => [...document.querySelectorAll<HTMLElement>("braccato-lyrics [data-nuvo-now]")].map((word) => word.textContent).join());
  const held = await read();
  await main.waitForTimeout(800);
  expect(await read()).toBe(held);
  expect(held).not.toBe("");
  await player("play()");
  await main.waitForTimeout(800);
  const result = report("after resume", await record(2_000));
  expectOneWordOnTime(result);
});

it("the mark never moves the layout: lines keep their boxes and nothing overflows the column", async () => {
  await player("seekTo(8800)");
  await main.waitForTimeout(500);
  const boxes = () =>
    main.evaluate(() => {
      const column = document.querySelector<HTMLElement>("braccato-lyrics")!;
      return {
        heights: [...column.querySelectorAll<HTMLElement>(".blyrics--line")].map((line) => line.offsetHeight),
        overflow: column.scrollWidth - column.clientWidth,
      };
    });
  const before = await boxes();
  await main.waitForTimeout(2_500);
  expect(await boxes()).toEqual(before);
  expect(before.overflow).toBeLessThanOrEqual(0);
});

it("reduced motion turns the fill into steps", async () => {
  await main.emulateMedia({ reducedMotion: "reduce" });
  await chooseMode("Fill");
  await player("pause()");
  expect(await pausedAt(2800)).toEqual({ words: ["Morning", "light", "over"], lines: 0, filling: null, progress: 0 });
  await main.emulateMedia({ reducedMotion: "no-preference" });
  await chooseMode("Word");
  await player("play()");
});

it("the fill is flat: two colours with a hard edge, no glow or filter", async () => {
  await chooseMode("Fill");
  await player("pause()");
  await pausedAt(2800);
  const fill = await main.evaluate(() => {
    const style = getComputedStyle(document.querySelector<HTMLElement>("braccato-lyrics [data-nuvo-fill]")!);
    return { shadow: style.textShadow, filter: style.filter, image: style.backgroundImage };
  });
  expect(fill).toMatchObject({ shadow: "none", filter: "none" });
  expect(fill.image).toMatch(/^linear-gradient\(90deg, rgb\(255, 255, 255\) [\d.]+%, .+ 0px\)$/);
  await chooseMode("Word");
  await player("play()");
});

it("the lit word is a flat colour: no glow, gradient or filter anywhere in the column", async () => {
  await player("seekTo(2300)");
  await main.waitForTimeout(400);
  const looks = await main.evaluate(() => {
    const word = document.querySelector<HTMLElement>("braccato-lyrics [data-nuvo-now]")!;
    const style = getComputedStyle(word);
    const run = document.querySelector<HTMLElement>("braccato-lyrics .blyrics-highlight-run");
    return {
      color: style.color,
      shadow: style.textShadow,
      filter: style.filter,
      image: style.backgroundImage,
      run: run ? getComputedStyle(run).display : "none",
    };
  });
  expect(looks).toEqual({ color: "rgb(255, 255, 255)", shadow: "none", filter: "none", image: "none", run: "none" });
});

async function setSize(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("file:") && !w.webContents.getURL().includes("#/notch"));
      if (!win) throw new Error("no main window");
      if (win.isMaximized()) win.unmaximize();
      win.setSize(size.width, size.height);
    },
    { width, height },
  );
  await main.waitForTimeout(500);
}

it("shots: dark at 1200 and Russian at 1100", async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await setSize(1200, 780);
  await player("seekTo(2300)");
  await main.waitForTimeout(700);
  await main.mouse.move(800, 20);
  await main.waitForTimeout(300);
  await main.screenshot({
    path: path.join(SHOTS, "karaoke-words-dark-1200.png"),
  });
  await player("seekTo(11500)");
  await main.waitForTimeout(700);
  await main.screenshot({
    path: path.join(SHOTS, "karaoke-words-wrap-1200.png"),
  });
  await player("seekTo(14800)");
  await main.waitForTimeout(700);
  await main.screenshot({
    path: path.join(SHOTS, "karaoke-words-rtl-1200.png"),
  });
  await player("seekTo(18600)");
  await main.waitForTimeout(700);
  await main.screenshot({
    path: path.join(SHOTS, "karaoke-words-cjk-1200.png"),
  });
  await main.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics), undefined, { timeout: 60_000 });
  await main.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
  await main.evaluate(() => {
    location.hash = "#/player";
  });
  await main.locator("braccato-lyrics .blyrics--line").first().waitFor({ timeout: 30_000 });
  await setSize(1100, 705);
  await player("seekTo(6200)");
  await player("play()");
  await main.waitForTimeout(900);
  await main.mouse.move(760, 20);
  await main.waitForTimeout(300);
  await main.screenshot({
    path: path.join(SHOTS, "karaoke-words-ru-1100.png"),
  });
  expect(await main.locator("button[aria-pressed]", { hasText: "Слово" }).count()).toBe(1);
});

it("line mode marks the line, no word, and the choice survives a reload", async () => {
  await main.locator("button[aria-pressed]", { hasText: "Строка" }).click({ force: true });
  await main.waitForTimeout(500);
  await player("play()");
  await player("seekTo(2800)");
  await main.waitForTimeout(400);
  expect(await main.locator("braccato-lyrics .blyrics--word[data-nuvo-now]").count()).toBe(0);
  expect(await main.locator("braccato-lyrics .blyrics--line[data-nuvo-now]").count()).toBe(1);
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics), undefined, { timeout: 60_000 });
  expect(await main.evaluate(() => localStorage.getItem("nuvo.karaoke.highlight"))).toBe("line");
});

it("with the user's own lyrics saved, the version menu lists both and switches back to the found one", async () => {
  type Lyrics = { reload(track: unknown): Promise<void>; getState(): { versions: unknown[]; activeVersion: string | null; wordTimed: boolean } };
  const route = `nuvo-core://local/v1/tracks/${SONG.id}/lyrics/user`;
  const status = await main.evaluate(
    async (url) =>
      (
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: "plain", content: "Own words\nSecond line" }),
        })
      ).status,
    route,
  );
  expect(status).toBeLessThan(300);
  await main.evaluate((song) => (window as unknown as { __nuvoLyrics: Lyrics }).__nuvoLyrics.reload(song), SONG);
  await main.waitForFunction(() => (window as unknown as { __nuvoLyrics: Lyrics }).__nuvoLyrics.getState().versions.length === 2, undefined, {
    timeout: 30_000,
  });
  await main.locator('header button[aria-label="Версия текста"]').click({ force: true });
  const items = main.locator('[role="menu"] [role="menuitem"]');
  await items.first().waitFor();
  expect(await items.allTextContents()).toEqual(["Ваш текст", "С временем по словам"]);
  await main.waitForTimeout(300);
  await main.screenshot({ path: path.join(SHOTS, "karaoke-versions-ru-1100.png") });
  await items.nth(1).click();
  await expect
    .poll(() => main.evaluate(() => (window as unknown as { __nuvoLyrics: Lyrics }).__nuvoLyrics.getState()))
    .toMatchObject({ activeVersion: "lrclib", wordTimed: true });
  await main.evaluate(async (url) => void (await fetch(url, { method: "DELETE" })), route);
});
