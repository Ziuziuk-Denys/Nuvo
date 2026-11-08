// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DislikeButton } from "./DislikeButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ dislike: vi.fn() }));
vi.mock("./notInterested", () => ({ songMenuNotInterested: mocks.dislike }));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const song = { id: "a", title: "Song", artists: "Nova", coverUrl: "", durationMs: 1000, playCount: 0 };

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.dislike.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const press = () => act(async () => host.querySelector("button")!.click());

describe("DislikeButton", () => {
  it("applies Not this recording with one press and says when it did", async () => {
    const done = vi.fn();
    act(() => root.render(<DislikeButton track={song} onDisliked={done} />));
    expect(host.querySelector("button")!.getAttribute("aria-label")).toBe("ui.recs.dislike");
    await press();
    expect(mocks.dislike).toHaveBeenCalledWith(song, "exact");
    expect(done).toHaveBeenCalledWith(song);
  });

  it("looks the song up first when the row only holds what was heard, and does nothing without one", async () => {
    act(() => root.render(<DislikeButton track={async () => song} />));
    await press();
    expect(mocks.dislike).toHaveBeenCalledWith(song, "exact");
    mocks.dislike.mockClear();
    act(() => root.render(<DislikeButton track={async () => null} />));
    await press();
    expect(mocks.dislike).not.toHaveBeenCalled();
  });
});
