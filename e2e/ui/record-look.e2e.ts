import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, RECORDING, type NuvoSession } from "./harness";

const PRESET_IDS = ["nuvo", "ink", "frost", "moss", "matcha", "amber", "dusk", "blossom", "velvet"];
const OUT = path.resolve(import.meta.dirname, "..", "..", "src", "data", "look", "presetTokens.json");
let session: NuvoSession;

beforeAll(async () => {
  session = await launchNuvo({ profile: "seeded" });
});
afterAll(async () => session?.close());

it.runIf(RECORDING)("records the preset tokens", async () => {
  const page = session.page;
  const result: Record<string, { modes: string[]; tokens: Record<string, Record<string, string>> }> = {};
  for (const id of PRESET_IDS) {
    result[id] = { modes: [], tokens: {} };
    for (const wanted of ["light", "dark"]) {
      // pending debounced store writes flush every second and would overwrite the blob below
      await page.waitForTimeout(1_100);
      await page.evaluate(
        ([preset, mode]) => {
          const key = "nuvo.look.v1";
          const stored = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":1}');
          stored.state.preset = preset;
          stored.state.themeBeforePreset = null;
          localStorage.setItem(key, JSON.stringify(stored));
          localStorage.setItem("theme", mode);
        },
        [id, wanted],
      );
      await page.reload();
      await page.waitForFunction((preset) => document.documentElement.dataset.preset === preset, id, { timeout: 30_000 });
      await page.waitForTimeout(1_500);
      const seen = await page.evaluate(() => {
        const root = document.documentElement;
        const tokens: Record<string, string> = {};
        for (let i = 0; i < root.style.length; i += 1) {
          const name = root.style.item(i);
          if (name.startsWith("--n-")) tokens[name.slice(2)] = root.style.getPropertyValue(name).trim();
        }
        const dark = root.getAttribute("data-theme") === "dark" || root.classList.contains("dark");
        return { mode: dark ? "dark" : "light", tokens };
      });
      if (seen.mode === wanted) {
        result[id].modes.push(wanted);
        result[id].tokens[wanted] = seen.tokens;
      }
    }
    expect(result[id].modes.length, `${id} shows at least one mode`).toBeGreaterThan(0);
  }
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
});
