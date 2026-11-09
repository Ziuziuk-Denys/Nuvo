import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";
import { passFirstRun } from "./ui/harness";

// Never mute or move a Nuvo stream with pactl: PipeWire remembers both per app name
const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const PACKAGED = process.env.NUVO_E2E_APP ?? "";
const SINK = `nuvo_e2e_${process.pid}`;
// music sits around 0.1 to 0.3; a muted or silent stream records exact zeros
const RMS_FLOOR = 0.01;
const QUERY = "Daft Punk Around the World";

const linux = process.platform === "linux";

function pactl(...args: string[]): string {
  return execFileSync("pactl", args, { encoding: "utf8" });
}

interface SinkInput {
  index: number;
  sink: number;
  mute: boolean;
  properties: Record<string, string>;
}

// Matched by profile on the command line: an AppImage forks the app off its launcher
function appInputs(userData: string): SinkInput[] {
  const inputs = JSON.parse(pactl("-f", "json", "list", "sink-inputs")) as SinkInput[];
  return inputs.filter((input) => {
    try {
      return readFileSync(`/proc/${input.properties["application.process.id"]}/cmdline`, "utf8").includes(`--user-data-dir=${userData}`);
    } catch {
      return false;
    }
  });
}

function stopApp(userData: string, signal: "TERM" | "KILL"): void {
  try {
    execFileSync("pkill", [`-${signal}`, "-f", "--", `--user-data-dir=${userData}`]);
  } catch {}
}

function rmsOf(raw: Buffer): number {
  const samples = Math.floor(raw.length / 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const value = raw.readInt16LE(i * 2) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, samples));
}

function record(ms: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const recorder = spawn("parecord", ["--raw", "--format=s16le", "--rate=48000", "--channels=2", "-d", `${SINK}.monitor`]);
    recorder.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    recorder.on("error", reject);
    setTimeout(() => recorder.kill("SIGTERM"), ms);
    recorder.on("exit", () => resolve(Buffer.concat(chunks)));
  });
}

describe.skipIf(!linux)("audio output", () => {
  let moduleId = "";
  let sinkIndex = -1;
  let isolation: Isolation;
  let child: ChildProcess;
  let browser: Browser;
  let page: Page;
  let guard: ReturnType<typeof setInterval> | undefined;
  let strayStream = "";
  const binary = PACKAGED || ELECTRON;

  beforeAll(async () => {
    moduleId = pactl("load-module", "module-null-sink", `sink_name=${SINK}`, `sink_properties=device.description=${SINK}`).trim();
    sinkIndex = (JSON.parse(pactl("-f", "json", "list", "short", "sinks")) as Array<{ index: number; name: string }>).find((s) => s.name === SINK)!.index;

    isolation = isolate("nuvo-audio");
    delete isolation.env.NUVO_CORE_TOOLS_URL;
    const args = [`--user-data-dir=${isolation.userData}`, "--remote-debugging-port=0"];
    child = spawn(binary, PACKAGED ? args : [ROOT, "--no-sandbox", ...args], {
      env: { ...isolation.env, PULSE_SINK: SINK },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no DevTools endpoint")), 60_000);
      let text = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        text += chunk.toString();
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(text);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
    });

    guard = setInterval(() => {
      try {
        const stray = appInputs(isolation.userData).find((input) => input.sink !== sinkIndex);
        if (stray && !strayStream) {
          strayStream = `stream ${stray.index} on sink ${stray.sink}`;
          stopApp(isolation.userData, "KILL");
        }
      } catch {}
    }, 50);

    browser = await chromium.connectOverCDP(endpoint);
    const deadline = Date.now() + 60_000;
    while (!page && Date.now() < deadline) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("file:") && !candidate.url().includes("#/notch"))!;
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!page) throw new Error("main window did not appear");
    await passFirstRun(page);
  }, 180_000);

  afterAll(async () => {
    if (guard) clearInterval(guard);
    await browser?.close().catch(() => undefined);
    if (isolation) {
      stopApp(isolation.userData, "TERM");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      stopApp(isolation.userData, "KILL");
    }
    if (moduleId) pactl("unload-module", moduleId);
    isolation?.dispose();
  });

  it("a song played from Search is heard: its sound reaches the output, unmuted and not silent", async () => {
    await page.evaluate(() => {
      location.hash = "#/search";
    });
    await page.getByRole("textbox", { name: "Search" }).fill(QUERY);
    await page.keyboard.press("Enter");
    const first = page.locator("[role=button]").filter({ hasText: "Around the World" }).first();
    await first.waitFor({ timeout: 30_000 });
    await first.click();

    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await pause.waitFor({ timeout: 60_000 });
    await expect
      .poll(() => appInputs(isolation.userData).length, { timeout: 60_000 })
      .toBeGreaterThan(0)
      .catch((error: unknown) => {
        const all = JSON.parse(pactl("-f", "json", "list", "sink-inputs")) as SinkInput[];
        console.log(
          all.map((input) => `${input.index} ${input.properties["application.name"]} pid ${input.properties["application.process.id"]} sink ${input.sink}`),
        );
        throw error;
      });
    await page.waitForTimeout(1500);

    const inputs = appInputs(isolation.userData);
    expect(strayStream).toBe("");
    expect(inputs.every((input) => input.sink === sinkIndex)).toBe(true);
    expect(inputs.map((input) => input.mute)).not.toContain(true);

    const rms = rmsOf(await record(4000));
    expect(strayStream).toBe("");
    expect(rms).toBeGreaterThan(RMS_FLOOR);

    expect(await page.evaluate(() => (window as unknown as { nuvoShell: { systemMuted(): Promise<boolean | null> } }).nuvoShell.systemMuted())).toBe(false);
    expect(
      await page
        .locator("[data-state-line]")
        .textContent()
        .catch(() => ""),
    ).not.toMatch(/Muted by your system|No sound reaches/);
  }, 180_000);
});
