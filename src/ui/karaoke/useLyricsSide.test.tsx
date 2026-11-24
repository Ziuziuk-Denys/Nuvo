// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLyricsSide } from "./useLyricsSide";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let open: boolean;

function View({ status }: { status: string }) {
  open = useLyricsSide(status);
  return null;
}

const show = (status: string) => act(() => root.render(<View status={status} />));
const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

it("keeps the lyrics side through a quick search and closes it through a long one", () => {
  show("ready");
  show("loading");
  pass(600);
  expect(open).toBe(true);
  show("ready");
  pass(2_000);
  expect(open).toBe(true);
  show("loading");
  pass(800);
  expect(open).toBe(false);
  show("ready");
  expect(open).toBe(true);
});

it("stays centred for a song without lyrics while the next one is searched", () => {
  show("none");
  expect(open).toBe(false);
  show("loading");
  expect(open).toBe(false);
  show("instrumental");
  pass(2_000);
  expect(open).toBe(false);
});
