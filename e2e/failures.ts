import fs from "node:fs";
import path from "node:path";
import { _electron, type ElectronApplication } from "playwright-core";
import { beforeEach, type RunnerTestCase } from "vitest";

const DIR = path.resolve(import.meta.dirname, "artifacts", "failures");
let current: RunnerTestCase | undefined;
let failures = 0;
let saved = 0;

beforeEach(({ task, onTestFailed }) => {
  current = task;
  onTestFailed(() => {
    failures += 1;
  });
});

async function keep(app: ElectronApplication): Promise<void> {
  const name = `${path.basename(current?.file.name ?? "unknown", ".e2e.ts")}-${current?.name ?? "hook"}-${++saved}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
  fs.mkdirSync(DIR, { recursive: true });
  for (const [index, window] of app.windows().entries()) {
    await window.screenshot({ path: path.join(DIR, `${name}-${index}.png`), timeout: 5_000 }).catch(() => undefined);
  }
  await app.context().tracing.stop({ path: path.join(DIR, `${name}.zip`) });
}

// the runtime dir is shared, so a test song would reach the Discord running on this machine
function discordOff(args: string[] = []): void {
  const userData = args.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  if (!userData) return;
  const settings = path.join(userData, "main-settings.json");
  if (fs.existsSync(settings)) return;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ discord: { enabled: false, chosen: true } }));
}

const launch = _electron.launch.bind(_electron);
_electron.launch = async (options) => {
  discordOff(options?.args);
  const app = await launch(options);
  const failuresAtLaunch = failures;
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  const close = app.close.bind(app);
  app.close = async () => {
    const failed = failures > failuresAtLaunch || current?.result?.state === "fail";
    await (failed ? keep(app) : app.context().tracing.stop()).catch(() => undefined);
    return close();
  };
  return app;
};
