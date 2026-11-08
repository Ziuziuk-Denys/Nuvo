// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { TFunction } from "../ports/i18n";
import { NotInterestedMenu } from "./NotInterestedMenu";
import { NOTICE_MS, useNotInterestedStore } from "./notInterested";
import { noticeText, UndoNotice, useUndoToast } from "./UndoNotice";
import { useToastStore } from "../feedback/toastStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  dislike: vi.fn(),
  undo: vi.fn(async (): Promise<true | "locked" | "unavailable"> => true),
}));
vi.mock("../ports/recs", () => ({ recsEnabled: true, dislike: mocks.dislike, recs: { undo: mocks.undo } }));
const t = ((key: string, vars?: Record<string, string>) => (vars ? `${key}|${Object.values(vars).join("|")}` : key)) as unknown as TFunction;
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t }) }));

const song = { id: "a", title: "Song", artists: "Nova, Orbit", artistList: [{ id: "n", name: "Nova" }], coverUrl: "", durationMs: 1000 };

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.dislike.mockReset();
  mocks.undo.mockClear();
  useNotInterestedStore.setState({ notice: null });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const notice = () => useNotInterestedStore.getState().notice;
const mount = () =>
  act(() =>
    root.render(
      <>
        <NotInterestedMenu track={song} open at={{ x: 10, y: 10 }} onClose={() => undefined} />
        <UndoNotice />
      </>,
    ),
  );

async function choose(label: string) {
  await act(async () => button(label)!.click());
  await act(async () => undefined);
}

describe("Not interested", () => {
  it("offers three scopes, then Undo for 8 s", async () => {
    mocks.dislike.mockResolvedValue({ suppressionId: 7, offerHideArtist: false });
    mount();
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual([
      "ui.recs.menu.exact",
      "ui.recs.menu.work",
      "ui.recs.menu.artist|Nova",
    ]);
    await choose("ui.recs.menu.work");
    expect(mocks.dislike).toHaveBeenCalledWith(song, "work");
    expect(noticeText(notice()!, t)).toBe("ui.recs.notice.work|Nova|Song");
    await choose("ui.recs.notice.undo");
    expect(mocks.undo).toHaveBeenCalledWith(7);
    expect(notice()).toBeNull();
  });

  it("the notice leaves after 8 s; a failed save says so without Undo", async () => {
    mocks.dislike.mockResolvedValue("unavailable");
    mount();
    await choose("ui.recs.menu.exact");
    expect(noticeText(notice()!, t)).toBe("ui.recs.notice.failed");
    expect(button("ui.recs.notice.undo")).toBeUndefined();
    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(notice()).toBeNull();
  });

  it("says when the vault is locked, not only that saving failed", async () => {
    mocks.dislike.mockResolvedValue("locked");
    mount();
    await choose("ui.recs.menu.exact");
    expect(noticeText(notice()!, t)).toBe("ui.recs.notice.locked");
    expect(button("ui.recs.notice.undo")).toBeUndefined();
  });

  it("passes on the daemon's offer to hide the artist for good", async () => {
    mocks.dislike.mockResolvedValueOnce({ suppressionId: 8, offerHideArtist: true }).mockResolvedValueOnce({ suppressionId: 9, offerHideArtist: false });
    mount();
    await choose("ui.recs.menu.artist|Nova");
    await choose("ui.recs.notice.hide_artist|Nova");
    expect(mocks.dislike).toHaveBeenLastCalledWith(song, "artist_forever");
    expect(noticeText(notice()!, t)).toBe("ui.recs.notice.artist_forever|Nova|Song");
  });

  it("keeps the notice and says why when Undo did not go through", async () => {
    mocks.dislike.mockResolvedValue({ suppressionId: 7, offerHideArtist: false });
    mocks.undo.mockResolvedValueOnce("locked");
    mount();
    await choose("ui.recs.menu.exact");
    await choose("ui.recs.notice.undo");
    expect(notice()).not.toBeNull();
    expect(noticeText(notice()!, t)).toBe("ui.recs.notice.undo_locked");
    expect(button("ui.recs.notice.undo")).toBeUndefined();

    mocks.dislike.mockResolvedValue({ suppressionId: 8, offerHideArtist: false });
    mocks.undo.mockResolvedValueOnce("unavailable");
    await choose("ui.recs.menu.exact");
    await choose("ui.recs.notice.undo");
    expect(noticeText(notice()!, t)).toBe("ui.recs.notice.undo_failed");
  });

  it("names the track the notice applies to", async () => {
    mocks.dislike.mockResolvedValue({ suppressionId: 7, offerHideArtist: false });
    mount();
    await choose("ui.recs.menu.exact");
    expect(noticeText(notice()!, t)).toContain("Song");
  });

  describe("with no bar on screen", () => {
    const Host = ({ bar }: { bar: boolean }) => {
      useUndoToast(bar);
      return null;
    };
    const toast = () => useToastStore.getState().queue[0];
    const made = { id: 9, track: song, scope: "exact", failure: null, suppressionId: 7, offerHideArtist: false } as const;

    beforeEach(() => useToastStore.setState({ queue: [] }));

    it("says it in a toast whose Undo undoes it, then lets the notice go", async () => {
      act(() => root.render(<Host bar={false} />));
      act(() => useNotInterestedStore.getState().setNotice(made));
      expect(toast().message).toBe("ui.recs.notice.exact|Nova|Song");
      await act(async () => toast().action?.onClick());
      expect(mocks.undo).toHaveBeenCalledWith(7);
      act(() => useNotInterestedStore.getState().setNotice(made));
      act(() => void vi.advanceTimersByTime(NOTICE_MS));
      expect(notice()).toBeNull();
      expect(useToastStore.getState().queue).toEqual([]);
    });

    it("stays out of the way while the bar shows the notice, and offers no Undo for a failure", () => {
      act(() => root.render(<Host bar />));
      act(() => useNotInterestedStore.getState().setNotice(made));
      expect(useToastStore.getState().queue).toEqual([]);
      act(() => root.render(<Host bar={false} />));
      act(() => useNotInterestedStore.getState().setNotice({ ...made, failure: "unavailable", suppressionId: null }));
      expect(toast().action).toBeUndefined();
      expect(toast().variant).toBe("error");
    });
  });
});
