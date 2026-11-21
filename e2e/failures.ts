import fs from "node:fs";
import path from "node:path";
import { _electron, type ElectronApplication } from "playwright-core";
import { beforeEach, type RunnerTestCase } from "vitest";

const DIR = path.resolve(import.meta.dirname, "artifacts", "failures");
let current: RunnerTestCase | undefined;
let fileFailed = false;
let saved = 0;

beforeEach(({ task, onTestFailed }) => {
  current = task;
  onTestFailed(() => {
    fileFailed = true;
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

const launch = _electron.launch.bind(_electron);
_electron.launch = async (options) => {
  const app = await launch(options);
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  const close = app.close.bind(app);
  app.close = async () => {
    const failed = fileFailed || current?.result?.state === "fail";
    await (failed ? keep(app) : app.context().tracing.stop()).catch(() => undefined);
    return close();
  };
  return app;
};
