import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLive, type Live } from "./live";
import type { ToStage } from "./stageProtocol";

const loading = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./cover", () => ({ loadCover: loading.load }));

const palette = { deep: [0, 0, 0], key: [0, 0, 0], cool: [0, 0, 0], light: [0, 0, 0] };
const bitmapOf = (name: string) => ({ name, close: vi.fn() });
let posted: ToStage[];
let live: Live;

beforeEach(() => {
  posted = [];
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(message: ToStage) {
        posted.push(message);
      }
      terminate() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const canvas = Object.assign(document.createElement("canvas"), { transferControlToOffscreen: () => ({}) });
  live = createLive(canvas as unknown as HTMLCanvasElement, { subscribe: () => () => undefined, clock: () => ({ atMs: 0, playing: false }) })!;
});

afterEach(() => {
  live.dispose();
  loading.load.mockReset();
  vi.unstubAllGlobals();
});

const covers = () =>
  posted.flatMap((message) => (message.type === "cover" ? [(message.cover?.bitmap as unknown as { name: string } | undefined)?.name ?? null] : []));

it("clears the last song's cover when the next one has none or cannot be loaded", async () => {
  loading.load.mockResolvedValueOnce({ bitmap: bitmapOf("first"), palette });
  live.setCover("first.jpg");
  await vi.waitFor(() => expect(covers()).toEqual(["first"]));
  live.setCover("");
  expect(covers()).toEqual(["first", null]);
  loading.load.mockRejectedValueOnce(new Error("gone"));
  live.setCover("broken.jpg");
  await vi.waitFor(() => expect(covers()).toEqual(["first", null, null]));
});

it("a late answer for a song that is over changes nothing", async () => {
  let fail: (error: Error) => void = () => undefined;
  loading.load.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
  live.setCover("slow.jpg");
  loading.load.mockResolvedValueOnce({ bitmap: bitmapOf("next"), palette });
  live.setCover("next.jpg");
  await vi.waitFor(() => expect(covers()).toEqual(["next"]));
  fail(new Error("late"));
  await Promise.resolve();
  expect(covers()).toEqual(["next"]);
});
