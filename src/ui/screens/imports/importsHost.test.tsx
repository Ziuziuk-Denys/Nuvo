// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { watchPendingTrack } from "@/imports/pending";
import { FakeDaemon, summary } from "@/imports/fixtures/fakeDaemon";
import { createImportsSession } from "@/imports/session";
import type { ImportActions } from "../../ports/imports";
import { ImportsHost } from "./ImportsHost";
import { useImportsUi } from "./importsUi";

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  }),
}));

const daemon = new FakeDaemon();
const session = createImportsSession(daemon, { youtube: async () => [], soundcloud: async () => [] }, { sleep: async () => {} });
const actions: ImportActions = {
  list: vi.fn(async () => ({
    source: "deezer" as const,
    label: "Northbound",
    rows: [{ title: "a", artists: [] }],
  })),
  listLikes: vi.fn(),
  post: vi.fn(async () => {
    const started = [summary("i1", { targetId: "pl-new", status: "done" })];
    session.started(started);
    return started;
  }),
  importFile: vi.fn(),
};
const pendingStore = {
  save: (job: Parameters<FakeDaemon["savePendingTrack"]>[0]) => void daemon.savePendingTrack(job),
  clear: () => void daemon.clearPendingTrack(),
};

vi.mock("../../ports/importsRuntime", () => ({
  getImports: () => ({
    daemon,
    session,
    actions,
    pendingStore,
    saveReport: null,
  }),
  watchPendingTrack,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useImportsUi.getState().close();
});

const click = async (name: string) => {
  const target = [...document.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;
  await act(async () => {
    target.click();
  });
};

describe("ImportsHost", () => {
  it("imports a link with a waiting song: the song joins the new playlist once and the sheet says so", async () => {
    await act(async () => {
      root.render(<ImportsHost />);
    });
    const song = {
      id: "aaaaaaaaaaa",
      title: "Paper Moons",
      artists: [],
      durationMs: 1,
    };
    await act(async () => {
      useImportsUi.getState().openImport({
        initialLink: "https://deezer.com/playlist/1",
        pendingTrack: song,
      });
    });
    await click("ui.imports.import");
    expect(daemon.addedToPlaylist).toEqual([{ playlistId: "pl-new", track: song }]);
    expect(document.body.textContent).toContain('ui.imports.pending_added {"title":"Paper Moons"}');
    expect(daemon.pending).toBeNull();
  });

  it("opens the report of a known import", async () => {
    await act(async () => {
      root.render(<ImportsHost />);
    });
    await act(async () => {
      useImportsUi.getState().openReport("i1");
    });
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("Northbound");
    expect(daemon.rowsCalls.at(-1)).toEqual({
      id: "i1",
      filter: "review",
      cursor: undefined,
    });
  });
});
