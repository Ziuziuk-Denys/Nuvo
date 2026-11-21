// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../../ports/search";
import { usePreparedStarts } from "./usePreparedStarts";

const prepareStarts = vi.hoisted(() => vi.fn());
vi.mock("../../ports/player", () => ({ playerEngine: { prepareStarts } }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  prepareStarts.mockClear();
});

function Probe({ results, ready }: { results: readonly SearchResult[]; ready: boolean }) {
  usePreparedStarts(results, ready);
  return null;
}

const render = (results: readonly SearchResult[], ready: boolean) => {
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(<Probe results={results} ready={ready} />));
};
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 200)));
const song = (id: string) => ({ id, kind: "song", title: id, track: { id, title: id } }) as unknown as SearchResult;

describe("usePreparedStarts", () => {
  it("never sends an empty list while mounted, so another screen keeps its prepared songs", async () => {
    render([], true);
    await wait();
    expect(prepareStarts).not.toHaveBeenCalled();
  });

  it("sends the songs once ready and lets them go on unmount", async () => {
    render([song("a"), song("b")], true);
    await wait();
    expect(prepareStarts).toHaveBeenLastCalledWith([expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })]);
    act(() => root!.unmount());
    root = null;
    expect(prepareStarts).toHaveBeenLastCalledWith([]);
  });
});
